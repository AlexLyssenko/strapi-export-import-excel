# Strapi Export/Import to Excel

## Overview
This plugin is designed for Strapi 5 and helps manage the export and import of big collection types within the content manager.

It is a fork of [export-import-kkm](https://github.com/kidkarnmai/export-import-kkm) by Kidkarnmai Studio Co., Ltd., reworked to handle large collections.

## Features
- Export collection types to an Excel file
- Import collection types from an Excel file
- Exports are generated on the server and streamed to the browser, so collections with hundreds of thousands of entries export with flat, low memory usage
- Exports respect the Content Manager's current filters, search, and locale, plus an optional date range on `createdAt`
- Relations are exported as the related entries' `documentId` (comma-separated for to-many relations)

## Installation
To install this plugin, run the following command in your Strapi project:

````
npm install export-import-strapi-to-excel
````

## Usage
1. Navigate to the content manager in your Strapi admin panel.
2. Use the export/import options available for collection types.

## Compatibility
Tested and developed with @strapi/strapi version ^5.10.3 and above.

## Note
1. For exporting data that includes components, the data can be extracted, and the information in that column will be in JSON format.
2. For importing data that includes components, if you do not import the data within the components, there will be no issues. However, if you do import, ensure that the JSON structure in those columns is correct and matches the structure when exported to function properly.
3. For export, relations are exported as `documentId` values: a single ID for to-one relations, a comma-separated list for to-many relations.
4. For import, related data is not supported, and if present, it will not affect any modifications.
5. Each export is a single sheet, and Excel sheets are limited to 1,048,576 rows.

## License
This project is licensed under the MIT License. See [LICENSE](LICENSE).

## Credits
Originally developed by Kidkarnmai Studio Co., Ltd. as [export-import-kkm](https://github.com/kidkarnmai/export-import-kkm). Maintained by Lyssenko Alexandr.

## Disclaimer
This plugin is provided "as is" without any warranty of any kind. Use it at your own risk. For issues and questions, please open an issue on [GitHub](https://github.com/AlexLyssenko/strapi-export-import-excel/issues).
