import React, { useEffect, useState } from 'react';
import { Button, DatePicker, Flex } from '@strapi/design-system';
import { useLocation } from 'react-router-dom';
import { useAuth, useFetchClient } from '@strapi/strapi/admin';
import qs from 'qs';


const ExportButton = () => {
  const { get } = useFetchClient();
  const token = useAuth('ExportButton', state => state.token);
  const location = useLocation();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [allowedExportCollections, setAllowedExportCollections] = useState([]);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Load config to get selectedExportCollections
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
        if (config && config.selectedExportCollections) {
          setAllowedExportCollections(config.selectedExportCollections);
        } else {
          setAllowedExportCollections([]);
        }
      } catch (error) {
        console.error('Error fetching config:', error);
      } finally {
        setLoadingConfig(false);
      }
    };
    fetchConfig();
  }, [get]);

  // Get the content type from the URL, e.g. "/content-manager/collection-types/api::article.article"
  const segments = location.pathname.split('/');
  const lastSegment = segments[segments.length - 1];
  const currentContentType = lastSegment;
  if (loadingConfig) return null;
  if (!allowedExportCollections.includes(currentContentType)) return null;

  const handleExport = async () => {
    // Build the confirmation message from the conditions used for the export
    let messageLines = [];

    // Date conditions
    if (startDate && endDate) {
      messageLines.push(`Date Range: ${startDate} to ${endDate}`);
    } else if (!startDate && !endDate) {
      messageLines.push('No date filter is applied (exporting ALL data)');
    } else {
      messageLines.push('Incomplete date filter provided (exporting ALL data)');
    }

    // Use qs to parse the query string from the URL
    const parsedQuery = qs.parse(location.search, { ignoreQueryPrefix: true });

    // Check filters (excluding createdAt)
    if (parsedQuery.filters) {
      let filters = parsedQuery.filters;
      if (filters.$and && Array.isArray(filters.$and)) {
        filters.$and = filters.$and.filter(condition => !('createdAt' in condition));
      } else if (filters.createdAt) {
        delete filters.createdAt;
      }
      // If filters are not empty, add them to the message
      if (filters && Object.keys(filters).length > 0) {
        messageLines.push(`Filters: ${JSON.stringify(filters)}`);
      }
    }

    // Check _q (keyword search)
    if (parsedQuery._q) {
      messageLines.push(`Search Keyword: ${parsedQuery._q}`);
    }

    // Combine the confirmation message
    const confirmMessage = `Export will be performed with the following conditions:\n\n${messageLines.join('\n')}\n\nProceed?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setIsExporting(true);

    // Get collectionName from the URL (e.g. "api::article.article" → "article")
    const parts = location.pathname.split('::');
    const collectionFull = parts[1] || '';
    const [collectionName] = collectionFull.split('.');

    try {
      let query = `collection=${collectionName}`;
      if (startDate && endDate) {
        query += `&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
      }
      if (parsedQuery.filters) {
        const filtersQuery = qs.stringify({ filters: parsedQuery.filters }, { encode: false });
        if (filtersQuery) {
          query += `&${filtersQuery}`;
        }
      }
      if (parsedQuery._q) {
        query += `&_q=${encodeURIComponent(parsedQuery._q)}`;
      }
      // Export the locale currently shown in the Content Manager (defaults to the default locale)
      const locale = parsedQuery.plugins?.i18n?.locale;
      if (locale) {
        query += `&locale=${encodeURIComponent(locale)}`;
      }

      // useFetchClient always parses responses as JSON, so the binary file
      // has to be fetched with native fetch.
      const response = await fetch(`${window.strapi.backendURL}/export-import-strapi-to-excel/export?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${collectionName}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

    } catch (error) {
      console.error('Export error:', error);
      window.alert(`Export failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Flex direction="row" gap={2}>
      <DatePicker label="Start Date" onChange={setStartDate} />
      <DatePicker label="End Date" onChange={setEndDate} />
      <Button onClick={handleExport} disabled={isExporting}>
        {isExporting ? 'Exporting...' : 'Export'}
      </Button>
    </Flex>
  );
};

export default ExportButton;
