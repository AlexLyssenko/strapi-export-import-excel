'use strict';

const importController = ({ strapi }) => ({
  async importData(ctx) {
    const { data } = ctx.request.body;
    const { rows, collectionName } = data || {};

    if (!collectionName) {
      return ctx.throw(400, 'collectionName is required');
    }
    if (!rows || !Array.isArray(rows)) {
      return ctx.throw(400, 'Invalid data: rows must be an array');
    }

    const modelName = `api::${collectionName}.${collectionName}`;

    const excludedKeys = [
      'id',
      'createdAt',
      'updatedAt',
      'publishedAt',
      'createdBy',
      'updatedBy',
      'localizations'
    ];

    const tryParseJSON = (value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            return JSON.parse(trimmed);
          } catch (error) {
            console.error('Error parsing JSON for value:', value, error);
            return value;
          }
        }
      }
      return value;
    };

    const isEmptyValue = (value) => {
      if (value == null) return true;
      if (typeof value === 'string' && value.trim() === '') return true;
      if (Array.isArray(value) && value.length === 0) return true;
      if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return true;
      return false;
    };

    const validateAndTransformRelations = async (row, modelName) => {
      try {
        const contentType = strapi.contentType(modelName);
        if (!contentType || !contentType.attributes) {
          return { transformedRow: row, hasInvalidReferences: false };
        }

        const transformedRow = { ...row };
        let hasInvalidReferences = false;
        
        for (const [key, value] of Object.entries(row)) {
          const attribute = contentType.attributes[key];
          
          // Handle relation fields
          if (attribute?.type === 'relation') {
            if (!value || isEmptyValue(value)) {
              delete transformedRow[key];
              continue;
            }
            if (typeof value === 'object' && (value.connect || value.set || value.disconnect)) {
              transformedRow[key] = value;
              continue;
            }
            
            // Extract documentIds to validate
            let docIds = [];
            if (typeof value === 'string') {
              docIds = [value];
            } else if (Array.isArray(value)) {
              docIds = value
                .filter((v) => v && !isEmptyValue(v))
                .map((item) => {
                  if (typeof item === 'string') return item;
                  if (item && typeof item === 'object' && item.documentId) return item.documentId;
                  return null;
                })
                .filter(Boolean);
            } else if (typeof value === 'object' && value.documentId) {
              docIds = [value.documentId];
            }
            
            // Validate relation references exist
            const validDocIds = [];
            const targetModel = attribute.target;
            
            for (const docId of docIds) {
              try {
                await strapi.documents(targetModel).findOne({ 
                  documentId: docId 
                });
                validDocIds.push(docId);
              } catch (error) {
                console.warn(`Relation not found: ${docId} for field ${key} in model ${targetModel}`);
                hasInvalidReferences = true;
              }
            }
            
            // Only set relation if we have valid references
            if (validDocIds.length > 0) {
              transformedRow[key] = {
                connect: validDocIds.map((id) => ({ documentId: id }))
              };
            } else {
              // Delete the field regardless of required status
              delete transformedRow[key];
              hasInvalidReferences = true;
            }
          }
        }
        return { transformedRow, hasInvalidReferences };
      } catch (error) {
        console.error('Error transforming relations:', error);
        throw error;
      }
    };

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let draftCount = 0;

    for (const row of rows) {
      try {
        let sanitizedRow = Object.keys(row).reduce((acc, key) => {
          if (!excludedKeys.includes(key)) {
            let parsedValue = tryParseJSON(row[key]);
            if (parsedValue && typeof parsedValue === 'object' && parsedValue.documentId && parsedValue.mime) {
              return acc;
            }
            if (!isEmptyValue(parsedValue)) {
              acc[key] = parsedValue;
            }
          }
          return acc;
        }, {});
        
        const { transformedRow, hasInvalidReferences } = await validateAndTransformRelations(sanitizedRow, modelName);
        sanitizedRow = transformedRow;

        if (sanitizedRow.documentId) {
          const existing = await strapi.documents(modelName).findOne({
            documentId: sanitizedRow.documentId,
            populate: '*',
          });
          if (existing) {
            await strapi.documents(modelName).update({
              documentId: sanitizedRow.documentId,
              data: sanitizedRow,
              populate: '*',
            });
            updatedCount++;
          } else {
            await strapi.documents(modelName).create({
              data: sanitizedRow,
              populate: '*',
              status: hasInvalidReferences ? 'draft' : 'published'
            });
            importedCount++;
            if (hasInvalidReferences) draftCount++;
          }
        } else {
          await strapi.documents(modelName).create({
            data: sanitizedRow,
            populate: '*',
            status: hasInvalidReferences ? 'draft' : 'published'
          });
          importedCount++;
          if (hasInvalidReferences) draftCount++;
        }
      } catch (error) {
        console.error('Error importing row:', row, error);
        console.error('Error details:', error.message);
        skippedCount++;
      }
    }

    ctx.body = {
      message: `Import completed for ${collectionName}`,
      importedCount,
      updatedCount,
      skippedCount,
      draftCount,
      totalRows: rows.length,
    };
  },
});

module.exports = importController;
