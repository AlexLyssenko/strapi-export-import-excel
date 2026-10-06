import React, { useEffect, useState, useRef } from 'react';
import { Button, Flex, Modal, Typography } from '@strapi/design-system';
import { useLocation } from 'react-router-dom';
import { useFetchClient } from '@strapi/strapi/admin';
import * as XLSX from 'xlsx';

const ImportButton = () => {
  const { get, post } = useFetchClient();
  const location = useLocation();

  const [allowedImportCollections, setAllowedImportCollections] = useState([]);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [dataRows, setDataRows] = useState([]);

  const [importResult, setImportResult] = useState(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const fileInputRef = useRef(null);

  // Load config to check whether this collection allows import
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await get('/export-import-strapi-to-excel/config');
        let config;
        if (Array.isArray(response.data)) {
          config = response.data[0];
        } else {
          config = response.data;
        }
        if (config && config.selectedImportCollections) {
          setAllowedImportCollections(config.selectedImportCollections);
        } else {
          setAllowedImportCollections([]);
        }
      } catch (error) {
        console.error('Error fetching config:', error);
      } finally {
        setLoadingConfig(false);
      }
    };
    fetchConfig();
  }, [get]);

  // Check whether the current page belongs to an allowed collection
  const segments = location.pathname.split('/');
  const lastSegment = segments[segments.length - 1];
  const currentContentType = lastSegment;
  if (loadingConfig) return null;
  if (!allowedImportCollections.includes(currentContentType)) return null;

  // Open the (hidden) file input
  const triggerFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // When the user selects a file, read it and convert it to an array of objects using the first row as the header
  const handleFileChange = (event) => {
    const selectedFile = event.target.files[0];
    if (!selectedFile) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const binaryStr = evt.target.result;
      const workbook = XLSX.read(binaryStr, { type: 'binary' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Read all data as an array of arrays
      let rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      if (rows.length === 0) {
        setDataRows([]);
        return;
      }
      // Take the first row as headerRow
      const [headerRow, ...bodyRows] = rows;
      // Filter out empty rows
      const filteredBody = bodyRows.filter((row) => row.some((cell) => cell));
      // Convert each row to an object using headerRow as keys
      const mappedData = filteredBody.map((row) => {
        const obj = {};
        row.forEach((cellValue, colIndex) => {
          const colName = headerRow[colIndex] || `col_${colIndex}`;
          obj[colName] = cellValue;
        });
        return obj;
      });
      console.log('Mapped data:', mappedData);
      setDataRows(mappedData);
    };
    reader.readAsBinaryString(selectedFile);
  };

  // Send import data in batches
  const handleImport = async () => {
    if (dataRows.length === 0) {
      console.error('No data to import');
      return;
    }
    // Get collectionName from the URL, e.g. "/content-manager/collection-types/api::article.article"
    const parts = location.pathname.split('::');
    const collectionFull = parts[1] || '';
    const [collectionName] = collectionFull.split('.');
    console.log('Collection Name:', collectionName);

    setIsImporting(true);
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    try {
      const batchSize = 100;
      for (let i = 0; i < dataRows.length; i += batchSize) {
        const batch = dataRows.slice(i, i + batchSize);
        const response = await post('/export-import-strapi-to-excel/import', {
          data: {
            rows: batch,
            collectionName, // Also send collectionName
          },
        });
        console.log(`Batch ${i / batchSize + 1} imported:`, response.data);
        importedCount += response.data.importedCount || 0;
        updatedCount += response.data.updatedCount || 0;
        skippedCount += response.data.skippedCount || 0;
      }
      setImportResult({
        message: `Import completed for ${collectionName}`,
        importedCount,
        updatedCount,
        skippedCount,
        totalRows: dataRows.length,
      });
      setShowResultModal(true);
    } catch (error) {
      console.error('Import error:', error);
    } finally {
      setIsImporting(false);
    }
  };

  // Close the result modal and reload the page
  const handleCloseResultModal = () => {
    setShowResultModal(false);
    window.location.reload();
  };

  // Close the confirm modal (cancel)
  const handleCloseConfirmModal = () => {
    setShowConfirmModal(false);
  };

  // Confirm import (when Confirm is clicked in the modal)
  const handleConfirmImport = async () => {
    setShowConfirmModal(false);
    await handleImport();
  };

  return (
    <>
      <Flex direction="row" gap={2}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <Button onClick={triggerFileInput} disabled={isImporting}>
          {dataRows.length > 0 ? `Selected ${dataRows.length} rows` : 'Import File'}
        </Button>
        {dataRows.length > 0 && (
          <Button onClick={() => setShowConfirmModal(true)} disabled={isImporting}>
            {isImporting ? 'Importing...' : 'Import Data'}
          </Button>
        )}
      </Flex>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <Modal.Root onClose={handleCloseConfirmModal} open={showConfirmModal}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>Confirm Import</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Typography>
                Are you sure you want to import the data? This action cannot be undone.
              </Typography>
            </Modal.Body>
            <Modal.Footer>
              <Modal.Close>
                <Button variant="tertiary" onClick={handleCloseConfirmModal}>
                  Cancel
                </Button>
              </Modal.Close>
              <Button onClick={handleConfirmImport}>Confirm</Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}

      {/* Result Modal */}
      {showResultModal && importResult && (
        <Modal.Root onClose={handleCloseResultModal} open={showResultModal}>
          <Modal.Content>
            <Modal.Header>
              <Modal.Title>Import Result</Modal.Title>
            </Modal.Header>
            <Modal.Body>
            <Typography as="p">{importResult.message}</Typography>
                <Typography as="p">Imported: {importResult.importedCount} rows</Typography>
                <Typography as="p">Updated: {importResult.updatedCount} rows</Typography>
                <Typography as="p">Skipped: {importResult.skippedCount} rows</Typography>
                <Typography as="p">Total Rows Processed: {importResult.totalRows}</Typography>
            </Modal.Body>
            <Modal.Footer  justifyContent="center">
              <Flex justifyContent="center">
                <Button onClick={handleCloseResultModal}>Reload</Button>
              </Flex>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      )}
    </>
  );
};

export default ImportButton;