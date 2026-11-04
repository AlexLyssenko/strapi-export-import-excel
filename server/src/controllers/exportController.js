'use strict';

import ExcelJS from 'exceljs';
import { PassThrough } from 'stream';

const PAGE_SIZE = 500;

const POPULATABLE_TYPES = ['relation', 'component', 'media', 'dynamiczone'];

// Same attributes as populate: '*', but relations only fetch their documentId.
// Polymorphic relations don't support field selection, so they're populated fully.
function buildPopulate(attributes) {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([, attr]) => POPULATABLE_TYPES.includes(attr.type))
      .map(([key, attr]) => [
        key,
        attr.type === 'relation' && !attr.relation?.startsWith('morph')
          ? { fields: ['documentId'] }
          : true,
      ])
  );
}

function relationCell(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(item => item.documentId).join(',');
  return value.documentId ?? null;
}

function toRow(record, relationKeys) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      if (relationKeys.has(key)) return [key, relationCell(value)];
      return [key, typeof value === 'object' && value !== null ? JSON.stringify(value) : value];
    })
  );
}

// Attribute types that can be filtered from the export dialog.
const FILTERABLE_TYPES = [
  'string', 'text', 'richtext', 'email', 'uid', 'enumeration',
  'integer', 'biginteger', 'float', 'decimal',
  'date', 'datetime', 'time', 'boolean', 'relation',
];

// Name of the extra column holding the Content Manager status (draft / published / modified).
// Falls back to another name if the collection already has a "status" attribute.
const statusColumnName = attributes => ('status' in attributes ? 'publicationStatus' : 'status');

// Same rules as the Content Manager list view: a document is "modified" when its
// draft was updated after the published version.
async function getStatuses(strapi, modelName, model, batch) {
  if (!model.options?.draftAndPublish) {
    return new Map(batch.map(record => [record.id, 'published']));
  }
  const locales = batch.map(record => record.locale).filter(Boolean);
  const published = await strapi.query(modelName).findMany({
    where: {
      documentId: { $in: batch.map(record => record.documentId) },
      publishedAt: { $notNull: true },
      ...(locales.length ? { locale: { $in: locales } } : {}),
    },
    select: ['documentId', 'locale', 'updatedAt'],
  });
  const publishedByKey = new Map(published.map(p => [`${p.documentId}:${p.locale ?? ''}`, p]));

  return new Map(
    batch.map(record => {
      const pub = publishedByKey.get(`${record.documentId}:${record.locale ?? ''}`);
      if (!pub) return [record.id, 'draft'];
      const modified = new Date(record.updatedAt).getTime() > new Date(pub.updatedAt).getTime();
      return [record.id, modified ? 'modified' : 'published'];
    })
  );
}

const STATUSES = ['draft', 'published', 'modified'];

// Status is computed, not stored, so status filters are applied to each batch in memory.
// statusFilters: an array of { $eq | $ne: 'draft' | 'published' | 'modified' } conditions.
const matchesStatusFilters = (status, statusFilters) =>
  statusFilters.every(condition =>
    Object.entries(condition).every(([operator, value]) => {
      if (operator === '$eq') return status === value;
      if (operator === '$ne') return status !== value;
      return true;
    })
  );

const exportController = ({ strapi }) => ({
  async getFields(ctx) {
    const { collection } = ctx.query;
    const model = strapi.getModel(`api::${collection}.${collection}`);
    if (!model) {
      return ctx.badRequest(`Unknown collection: ${collection}`);
    }
    ctx.body = [
      { name: 'id', type: 'integer' },
      { name: 'documentId', type: 'string' },
      ...Object.entries(model.attributes)
        .filter(([, attr]) => FILTERABLE_TYPES.includes(attr.type))
        .filter(([, attr]) => attr.type !== 'relation' || !attr.relation?.startsWith('morph'))
        .map(([name, attr]) => ({
          name,
          type: attr.type,
          ...(attr.enum ? { enum: attr.enum } : {}),
        })),
      // Without Draft & Publish every entry is "published", so the filter would be pointless.
      ...(model.options?.draftAndPublish
        ? [{ name: statusColumnName(model.attributes), type: 'status', enum: STATUSES }]
        : []),
    ];
  },

  async exportData(ctx) {
    const { collection, startDate, endDate, _q, locale, fieldFilters, statusFilters } = ctx.query;

    const startISODate = startDate ? new Date(startDate).toISOString() : null;
    const endISODate = endDate
      ? new Date(new Date(endDate).setDate(new Date(endDate).getDate() + 1)).toISOString()
      : null;

    const modelName = `api::${collection}.${collection}`;
    const model = strapi.getModel(modelName);
    if (!model) {
      return ctx.badRequest(`Unknown collection: ${collection}`);
    }
    const relationKeys = new Set(
      Object.entries(model.attributes)
        .filter(([, attr]) => attr.type === 'relation')
        .map(([key]) => key)
    );

    const statusColumn = statusColumnName(model.attributes);
    const statusConditions = Array.isArray(statusFilters) ? statusFilters : [];

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

    // Field filters from the export dialog: an array of { field: { $op: value } } conditions.
    if (Array.isArray(fieldFilters) && fieldFilters.length > 0) {
      filters.$and = [...(Array.isArray(filters.$and) ? filters.$and : []), ...fieldFilters];
    }

    const baseQuery = {
      populate: buildPopulate(model.attributes),
      ...(_q ? { _q } : {}),
      ...(locale ? { locale } : {}),
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

    (async () => {
      const expected = await strapi.documents(modelName).count({ filters, ...(_q ? { _q } : {}), ...(locale ? { locale } : {}) });
      strapi.log.info(
        `[export-import-strapi-to-excel] Streaming export of ${collection} started (${expected} documents)`
      );

      // Keyset pagination on id: offset paging without a stable order can skip or
      // duplicate rows, and gets slower the deeper it goes.
      let lastId = 0;
      let scanned = 0;
      let written = 0;
      let headersSet = false;

      while (true) {
        const batch = await strapi.documents(modelName).findMany({
          ...baseQuery,
          filters: { $and: [filters, { id: { $gt: lastId } }] },
          sort: { id: 'asc' },
          limit: PAGE_SIZE,
        });

        if (batch.length === 0) break;

        const statuses = await getStatuses(strapi, modelName, model, batch);

        for (const record of batch) {
          const status = statuses.get(record.id);
          if (!matchesStatusFilters(status, statusConditions)) continue;
          const flat = { ...toRow(record, relationKeys), [statusColumn]: status };
          if (!headersSet) {
            worksheet.columns = Object.keys(flat).map(key => ({ header: key, key }));
            headersSet = true;
          }
          worksheet.addRow(flat).commit();
          written++;
        }

        scanned += batch.length;
        lastId = batch[batch.length - 1].id;

        if (batch.length < PAGE_SIZE) break;

        if (scanned % (PAGE_SIZE * 20) === 0) {
          strapi.log.info(`[export-import-strapi-to-excel] ${collection}: ${written}/${expected} rows written`);
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
      strapi.log.info(`[export-import-strapi-to-excel] Export of ${collection} finished: ${written}/${expected} rows`);
    })().catch(err => {
      strapi.log.error(`[export-import-strapi-to-excel] Export of ${collection} failed: ${err.message}`);
      stream.destroy(err);
    });
  },
});

export default exportController;
