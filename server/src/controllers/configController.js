'use strict';

module.exports = {
  async getConfig(ctx) {
    // Get the saved configuration from the database
    const configs = await strapi.entityService.findMany('plugin::export-import-strapi-to-excel.export-import-config', {
      filters: {},
    });

    if (configs && configs.length > 0) {
      ctx.body = configs[0];
    } else {
      // If there is no config yet, return the defaults
      ctx.body = {
        selectedExportCollections: [],
        selectedImportCollections: [],
      };
    }
  },

  async saveConfig(ctx) {
    const { data } = ctx.request.body;
    const { selectedExportCollections, selectedImportCollections } = data;

    // Check that it is an array
    if (!Array.isArray(selectedExportCollections) || !Array.isArray(selectedImportCollections)) {
      return ctx.throw(400, 'selectedExportCollections and selectedImportCollections must be arrays');
    }

    // Find the existing config (assuming only a single entry is stored)
    const existingConfigs = await strapi.entityService.findMany('plugin::export-import-strapi-to-excel.export-import-config', {
      filters: {},
    });

    let result;
    if (existingConfigs.length > 0) {
      // Update the first entry
      result = await strapi.entityService.update(
        'plugin::export-import-strapi-to-excel.export-import-config',
        existingConfigs[0].id,
        {
          data: { selectedExportCollections, selectedImportCollections },
        }
      );
    } else {
      // Create a new entry
      result = await strapi.entityService.create('plugin::export-import-strapi-to-excel.export-import-config', {
        data: { selectedExportCollections, selectedImportCollections },
      });
    }
    ctx.body = result;
  },
};
