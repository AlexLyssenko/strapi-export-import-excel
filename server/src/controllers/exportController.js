'use strict';

import ExcelJS from 'exceljs';
import { PassThrough } from 'stream';

const PAGE_SIZE = 500;

function flattenObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      typeof value === 'object' && value !== null ? JSON.stringify(value) : value,
    ])
  );
}

const exportController = ({ strapi }) => ({
  async exportData(ctx) {
    const { collection, startDate, endDate, _q } = ctx.query;

    const startISODate = startDate ? new Date(startDate).toISOString() : null;
    const endISODate = endDate
      ? new Date(new Date(endDate).setDate(new Date(endDate).getDate() + 1)).toISOString()
      : null;

    const modelName = `api::${collection}.${collection}`;

    const filters = {};

    if (ctx.query.filters) {
      const userFilters = { ...ctx.query.filters };
      if (userFilters.$and && Array.isArray(userFilters.$and)) {
        userFilters.$and = userFilters.$and.filter(condition => !('createdAt' in condition));
      } else if (userFilters.createdAt) {
        delete userFilters.createdAt;
      }
      Object.assign(filters, userFilters);
    }

    if (startISODate && endISODate) {
      filters.createdAt = { $gte: startISODate, $lt: endISODate };
    }

    const baseQuery = {
      populate: '*',
      filters,
      ...(_q ? { _q } : {}),
    };

    // Stream the workbook straight to the response: rows are serialized and
    // released as they are committed, so memory stays flat regardless of size.
    const stream = new PassThrough();
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useStyles: false,
      useSharedStrings: false,
    });
    const worksheet = workbook.addWorksheet('Export Data');

    ctx.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    ctx.set('Content-Disposition', `attachment; filename="${collection}.xlsx"`);
    ctx.body = stream;
    // Stop querying the DB if the client disconnects mid-export.
    ctx.res.on('close', () => {
      if (!ctx.res.writableFinished) stream.destroy();
    });

    strapi.log.info(`[export-import-kkm] Streaming export of ${collection} started`);

    (async () => {
      let start = 0;
      let headersSet = false;

      while (true) {
        const batch = await strapi.documents(modelName).findMany({
          ...baseQuery,
          limit: PAGE_SIZE,
          start,
        });

        if (batch.length === 0) break;

        for (const record of batch) {
          const flat = flattenObject(record);
          if (!headersSet) {
            worksheet.columns = Object.keys(flat).map(key => ({ header: key, key }));
            headersSet = true;
          }
          worksheet.addRow(flat).commit();
        }

        if (batch.length < PAGE_SIZE) break;
        start += PAGE_SIZE;

        if (start % (PAGE_SIZE * 20) === 0) {
          strapi.log.info(`[export-import-kkm] ${collection}: ${start} rows written`);
        }

        // Backpressure: don't fetch more while the client hasn't consumed what was sent.
        if (stream.writableNeedDrain) {
          await new Promise(resolve => {
            stream.once('drain', resolve);
            stream.once('close', resolve);
          });
        }
        if (stream.destroyed) return;
      }

      worksheet.commit();
      await workbook.commit();
      strapi.log.info(`[export-import-kkm] Export of ${collection} finished`);
    })().catch(err => {
      strapi.log.error(`[export-import-kkm] Export of ${collection} failed: ${err.message}`);
      stream.destroy(err);
    });
  },
});

export default exportController;
