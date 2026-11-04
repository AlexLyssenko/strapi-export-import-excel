import React, { useEffect, useState } from 'react';
import {
  Button,
  DatePicker,
  Flex,
  IconButton,
  Modal,
  SingleSelect,
  SingleSelectOption,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Plus, Trash } from '@strapi/icons';
import { useLocation } from 'react-router-dom';
import { useAuth, useFetchClient } from '@strapi/strapi/admin';
import qs from 'qs';

const TEXT_TYPES = ['string', 'text', 'richtext', 'email', 'uid'];
const NUMBER_TYPES = ['integer', 'biginteger', 'float', 'decimal'];
const DATE_TYPES = ['date', 'datetime', 'time'];

const NULL_OPERATORS = [
  { value: '$null', label: 'is empty' },
  { value: '$notNull', label: 'is not empty' },
];

const isNullOperator = operator => operator === '$null' || operator === '$notNull';

const getOperators = type => {
  if (TEXT_TYPES.includes(type)) {
    return [
      { value: '$eq', label: 'is' },
      { value: '$ne', label: 'is not' },
      { value: '$containsi', label: 'contains' },
      { value: '$notContainsi', label: 'does not contain' },
      { value: '$startsWithi', label: 'starts with' },
      { value: '$endsWithi', label: 'ends with' },
      ...NULL_OPERATORS,
    ];
  }
  if (NUMBER_TYPES.includes(type) || DATE_TYPES.includes(type)) {
    return [
      { value: '$eq', label: '=' },
      { value: '$ne', label: '≠' },
      { value: '$gt', label: '>' },
      { value: '$gte', label: '≥' },
      { value: '$lt', label: '<' },
      { value: '$lte', label: '≤' },
      ...NULL_OPERATORS,
    ];
  }
  if (type === 'status') {
    return [{ value: '$eq', label: 'is' }, { value: '$ne', label: 'is not' }];
  }
  if (type === 'relation') {
    return [{ value: '$eq', label: 'documentId is' }, ...NULL_OPERATORS];
  }
  // boolean, enumeration
  return [{ value: '$eq', label: 'is' }, { value: '$ne', label: 'is not' }, ...NULL_OPERATORS];
};

const getInputType = type => {
  if (NUMBER_TYPES.includes(type)) return 'number';
  if (type === 'date') return 'date';
  if (type === 'datetime') return 'datetime-local';
  if (type === 'time') return 'time';
  return 'text';
};

const isComplete = (row, field) => {
  if (!field || !row.operator) return false;
  return isNullOperator(row.operator) || row.value !== '';
};

// Turn a filter row into a Strapi filter condition, e.g. { title: { $containsi: 'foo' } }
const toCondition = (row, field) => {
  let value = isNullOperator(row.operator) ? true : row.value;
  if (!isNullOperator(row.operator) && field.type === 'datetime') value = new Date(value).toISOString();
  if (field.type === 'relation') {
    return { [field.name]: { documentId: { [row.operator]: value } } };
  }
  return { [field.name]: { [row.operator]: value } };
};

const describeRow = (row, field) => {
  const op = getOperators(field.type).find(o => o.value === row.operator);
  return `${field.name} ${op ? op.label : row.operator}${isNullOperator(row.operator) ? '' : ` "${row.value}"`}`;
};

let rowKey = 0;
const newRow = () => ({ key: ++rowKey, field: '', operator: '', value: '' });

const ExportButton = () => {
  const { get } = useFetchClient();
  const token = useAuth('ExportButton', state => state.token);
  const location = useLocation();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [allowedExportCollections, setAllowedExportCollections] = useState([]);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [fields, setFields] = useState([]);
  const [filterRows, setFilterRows] = useState([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

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

  // Get collectionName from the URL (e.g. "api::article.article" → "article")
  const collectionFull = location.pathname.split('::')[1] || '';
  const [collectionName] = collectionFull.split('.');
  const isAllowed = allowedExportCollections.includes(currentContentType);

  // Load the filterable fields of the current collection
  useEffect(() => {
    setFilterRows([]);
    if (!isAllowed || !collectionName) return;
    const fetchFields = async () => {
      try {
        const response = await get(
          `/export-import-strapi-to-excel/fields?collection=${encodeURIComponent(collectionName)}`
        );
        setFields(Array.isArray(response.data) ? response.data : []);
      } catch (error) {
        console.error('Error fetching fields:', error);
        setFields([]);
      }
    };
    fetchFields();
  }, [get, collectionName, isAllowed]);

  if (loadingConfig) return null;
  if (!isAllowed) return null;

  const fieldByName = name => fields.find(f => f.name === name);
  const updateRow = (key, patch) =>
    setFilterRows(rows => rows.map(row => (row.key === key ? { ...row, ...patch } : row)));
  const removeRow = key => setFilterRows(rows => rows.filter(row => row.key !== key));
  const activeRows = filterRows.filter(row => isComplete(row, fieldByName(row.field)));

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

    // Field filters from the export dialog
    activeRows.forEach(row => {
      messageLines.push(`Field filter: ${describeRow(row, fieldByName(row.field))}`);
    });

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
      // Status is computed on the server, so it travels separately from the field filters.
      const statusRows = activeRows.filter(row => fieldByName(row.field).type === 'status');
      const fieldRows = activeRows.filter(row => fieldByName(row.field).type !== 'status');
      if (fieldRows.length > 0) {
        const fieldFilters = fieldRows.map(row => toCondition(row, fieldByName(row.field)));
        query += `&${qs.stringify({ fieldFilters })}`;
      }
      if (statusRows.length > 0) {
        const statusFilters = statusRows.map(row => ({ [row.operator]: row.value }));
        query += `&${qs.stringify({ statusFilters })}`;
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
      <Modal.Root open={isFilterOpen} onOpenChange={setIsFilterOpen}>
        <Modal.Trigger>
          <Button variant="secondary" onClick={() => filterRows.length === 0 && setFilterRows([newRow()])}>
            {activeRows.length > 0 ? `Filters (${activeRows.length})` : 'Filters'}
          </Button>
        </Modal.Trigger>
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>Export filters</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Flex direction="column" alignItems="stretch" gap={3}>
              {filterRows.length === 0 && (
                <Typography textColor="neutral600">No field filters, all rows will be exported.</Typography>
              )}
              {filterRows.map(row => {
                const field = fieldByName(row.field);
                const operators = field ? getOperators(field.type) : [];
                const needsValue = field && row.operator && !isNullOperator(row.operator);
                const isSelectValue = field && ['boolean', 'enumeration', 'status'].includes(field.type);
                return (
                  <Flex key={row.key} gap={2} alignItems="flex-end">
                    <SingleSelect
                      aria-label="Field"
                      placeholder="Field"
                      value={row.field}
                      onChange={value => {
                        const nextField = fieldByName(value);
                        updateRow(row.key, { field: value, operator: getOperators(nextField.type)[0].value, value: '' });
                      }}
                    >
                      {fields.map(f => (
                        <SingleSelectOption key={f.name} value={f.name}>
                          {f.name}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                    <SingleSelect
                      aria-label="Operator"
                      placeholder="Operator"
                      value={row.operator}
                      disabled={!field}
                      onChange={value => updateRow(row.key, { operator: value })}
                    >
                      {operators.map(op => (
                        <SingleSelectOption key={op.value} value={op.value}>
                          {op.label}
                        </SingleSelectOption>
                      ))}
                    </SingleSelect>
                    {needsValue && isSelectValue && (
                      <SingleSelect
                        aria-label="Value"
                        placeholder="Value"
                        value={row.value}
                        onChange={value => updateRow(row.key, { value })}
                      >
                        {(field.type === 'boolean' ? ['true', 'false'] : field.enum || []).map(v => (
                          <SingleSelectOption key={v} value={v}>
                            {v}
                          </SingleSelectOption>
                        ))}
                      </SingleSelect>
                    )}
                    {needsValue && !isSelectValue && (
                      <TextInput
                        aria-label="Value"
                        placeholder={field.type === 'relation' ? 'documentId' : 'Value'}
                        type={getInputType(field.type)}
                        value={row.value}
                        onChange={e => updateRow(row.key, { value: e.target.value })}
                      />
                    )}
                    <IconButton label="Remove filter" onClick={() => removeRow(row.key)}>
                      <Trash />
                    </IconButton>
                  </Flex>
                );
              })}
              <Flex>
                <Button
                  variant="tertiary"
                  startIcon={<Plus />}
                  onClick={() => setFilterRows(rows => [...rows, newRow()])}
                >
                  Add filter
                </Button>
              </Flex>
            </Flex>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="tertiary" onClick={() => setFilterRows([])}>
              Clear all
            </Button>
            <Modal.Close>
              <Button>Done</Button>
            </Modal.Close>
          </Modal.Footer>
        </Modal.Content>
      </Modal.Root>
      <Button onClick={handleExport} disabled={isExporting}>
        {isExporting ? 'Exporting...' : 'Export'}
      </Button>
    </Flex>
  );
};

export default ExportButton;
