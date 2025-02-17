import { Button, Dropdown, Menu, Modal, Space, Switch } from 'antd';
import { FilterDropdownProps, SorterResult } from 'antd/lib/table/interface';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import FilterCounter from 'components/FilterCounter';
import InlineEditor from 'components/InlineEditor';
import InteractiveTable, { ColumnDef, InteractiveTableSettings,
  onRightClickableCell } from 'components/InteractiveTable';
import Label, { LabelTypes } from 'components/Label';
import Link from 'components/Link';
import showModalItemCannotDelete from 'components/ModalItemDelete';
import Page from 'components/Page';
import { checkmarkRenderer, defaultRowClassName, getFullPaginationConfig, modelNameRenderer,
  relativeTimeRenderer, userRenderer } from 'components/Table';
import TableFilterDropdown from 'components/TableFilterDropdown';
import TableFilterSearch from 'components/TableFilterSearch';
import TagList from 'components/TagList';
import { useStore } from 'contexts/Store';
import useCreateModelModal from 'hooks/useCreateModelModal';
import { useFetchUsers } from 'hooks/useFetch';
import usePolling from 'hooks/usePolling';
import useSettings, { UpdateSettings } from 'hooks/useSettings';
import { paths } from 'routes/utils';
import { archiveModel, deleteModel, getModelLabels,
  getModels, patchModel, unarchiveModel } from 'services/api';
import { V1GetModelsRequestSortBy } from 'services/api-ts-sdk';
import Icon from 'shared/components/Icon/Icon';
import { isEqual } from 'shared/utils/data';
import { ModelItem } from 'types';
import handleError from 'utils/error';
import { alphaNumericSorter } from 'utils/sort';
import { getDisplayName } from 'utils/user';

import { ErrorType } from '../shared/utils/error';
import { validateDetApiEnum } from '../shared/utils/service';

import css from './ModelRegistry.module.scss';
import settingsConfig, {
  DEFAULT_COLUMN_WIDTHS,
  ModelColumnName,
  Settings,
} from './ModelRegistry.settings';

const filterKeys: Array<keyof Settings> = [ 'tags', 'name', 'users', 'description' ];

const ModelRegistry: React.FC = () => {
  const { users, auth: { user } } = useStore();
  const [ models, setModels ] = useState<ModelItem[]>([]);
  const [ tags, setTags ] = useState<string[]>([]);
  const [ isLoading, setIsLoading ] = useState(true);
  const [ canceler ] = useState(new AbortController());
  const [ total, setTotal ] = useState(0);
  const { showModal } = useCreateModelModal();
  const pageRef = useRef<HTMLElement>(null);

  const {
    activeSettings,
    settings,
    updateSettings,
    resetSettings,
  } = useSettings<Settings>(settingsConfig);

  const filterCount = useMemo(() => activeSettings(filterKeys).length, [ activeSettings ]);

  const fetchUsers = useFetchUsers(canceler);

  const fetchModels = useCallback(async () => {
    try {
      const response = await getModels({
        archived: settings.archived ? undefined : false,
        description: settings.description,
        labels: settings.tags,
        limit: settings.tableLimit,
        name: settings.name,
        offset: settings.tableOffset,
        orderBy: settings.sortDesc ? 'ORDER_BY_DESC' : 'ORDER_BY_ASC',
        sortBy: validateDetApiEnum(V1GetModelsRequestSortBy, settings.sortKey),
        users: settings.users,
      }, { signal: canceler.signal });
      setTotal(response.pagination.total || 0);
      setModels(prev => {
        if (isEqual(prev, response.models)) return prev;
        return response.models;
      });
      setIsLoading(false);
    } catch(e) {
      handleError(e, {
        publicSubject: 'Unable to fetch models.',
        silent: true,
        type: ErrorType.Api,
      });
      setIsLoading(false);
    }
  }, [ settings, canceler.signal ]);

  const fetchTags = useCallback(async () => {
    try {
      const tags = await getModelLabels({ signal: canceler.signal });
      tags.sort((a, b) => alphaNumericSorter(a, b));
      setTags(tags);
    } catch (e) { handleError(e); }
  }, [ canceler.signal ]);

  const fetchAll = useCallback(async () => {
    await Promise.allSettled([ fetchModels(), fetchTags(), fetchUsers() ]);
  }, [ fetchModels, fetchTags, fetchUsers ]);

  usePolling(fetchAll, { rerunOnNewFn: true });

  /*
   * Get new models based on changes to the
   * pagination and sorter.
   */
  useEffect(() => {
    setIsLoading(true);
    fetchModels();
  }, [
    fetchModels,
    settings,
  ]);

  const deleteCurrentModel = useCallback((model: ModelItem) => {
    deleteModel({ modelName: model.name });
    fetchModels();
  }, [ fetchModels ]);

  const switchArchived = useCallback(async (model: ModelItem) => {
    try {
      setIsLoading(true);
      if (model.archived) {
        await unarchiveModel({ modelName: model.name });
      } else {
        await archiveModel({ modelName: model.name });
      }
      await fetchModels();
    } catch (e) {
      handleError(e, {
        publicSubject: `Unable to switch model ${model.id} archive status.`,
        silent: true,
        type: ErrorType.Api,
      });
      setIsLoading(false);
    }
  }, [ fetchModels ]);

  const setModelTags = useCallback(async (modelName, tags) => {
    try {
      setIsLoading(true);
      await patchModel({ body: { labels: tags, name: modelName }, modelName });
      await fetchModels();
    } catch (e) {
      handleError(e, {
        publicSubject: `Unable to update model ${modelName} tags.`,
        silent: true,
        type: ErrorType.Api,
      });
      setIsLoading(false);
    }
  }, [ fetchModels ]);

  const handleUserFilterApply = useCallback((users: string[]) => {
    updateSettings({ users: users.length !== 0 ? users : undefined });
  }, [ updateSettings ]);

  const handleUserFilterReset = useCallback(() => {
    updateSettings({ users: undefined });
  }, [ updateSettings ]);

  const userFilterDropdown = useCallback((filterProps: FilterDropdownProps) => (
    <TableFilterDropdown
      {...filterProps}
      multiple
      searchable
      values={settings.users}
      onFilter={handleUserFilterApply}
      onReset={handleUserFilterReset}
    />
  ), [ handleUserFilterApply, handleUserFilterReset, settings.users ]);

  const tableSearchIcon = useCallback(() => <Icon name="search" size="tiny" />, []);

  const handleNameSearchApply = useCallback((newSearch: string) => {
    updateSettings({ name: newSearch || undefined });
  }, [ updateSettings ]);

  const handleNameSearchReset = useCallback(() => {
    updateSettings({ name: undefined });
  }, [ updateSettings ]);

  const nameFilterSearch = useCallback((filterProps: FilterDropdownProps) => (
    <TableFilterSearch
      {...filterProps}
      value={settings.name || ''}
      onReset={handleNameSearchReset}
      onSearch={handleNameSearchApply}
    />
  ), [ handleNameSearchApply, handleNameSearchReset, settings.name ]);

  const handleDescriptionSearchApply = useCallback((newSearch: string) => {
    updateSettings({ description: newSearch || undefined });
  }, [ updateSettings ]);

  const handleDescriptionSearchReset = useCallback(() => {
    updateSettings({ description: undefined });
  }, [ updateSettings ]);

  const descriptionFilterSearch = useCallback((filterProps: FilterDropdownProps) => (
    <TableFilterSearch
      {...filterProps}
      value={settings.description || ''}
      onReset={handleDescriptionSearchReset}
      onSearch={handleDescriptionSearchApply}
    />
  ), [ handleDescriptionSearchApply, handleDescriptionSearchReset, settings.description ]);

  const handleLabelFilterApply = useCallback((tags: string[]) => {
    updateSettings({ tags: tags.length !== 0 ? tags : undefined });
  }, [ updateSettings ]);

  const handleLabelFilterReset = useCallback(() => {
    updateSettings({ tags: undefined });
  }, [ updateSettings ]);

  const labelFilterDropdown = useCallback((filterProps: FilterDropdownProps) => (
    <TableFilterDropdown
      {...filterProps}
      multiple
      searchable
      values={settings.tags}
      onFilter={handleLabelFilterApply}
      onReset={handleLabelFilterReset}
    />
  ), [ handleLabelFilterApply, handleLabelFilterReset, settings.tags ]);

  const showConfirmDelete = useCallback((model: ModelItem) => {
    Modal.confirm({
      closable: true,
      content: `Are you sure you want to delete this model "${model.name}" and all
      of its versions from the model registry?`,
      icon: null,
      maskClosable: true,
      okText: 'Delete Model',
      okType: 'danger',
      onOk: () => deleteCurrentModel(model),
      title: 'Confirm Delete',
    });
  }, [ deleteCurrentModel ]);

  const saveModelDescription = useCallback(async (modelName: string, editedDescription: string) => {
    try {
      await patchModel({
        body: { description: editedDescription, name: modelName },
        modelName,
      });
    } catch (e) {
      handleError(e, {
        publicSubject: 'Unable to save model description.',
        silent: false,
        type: ErrorType.Api,
      });
      setIsLoading(false);
    }
  }, []);

  const resetColumnWidths = useCallback(
    () =>
      updateSettings({ columnWidths: settings.columns.map((col) => DEFAULT_COLUMN_WIDTHS[col]) }),
    [ settings.columns, updateSettings ],
  );

  const resetFilters = useCallback(() => {
    resetSettings([ ...filterKeys, 'tableOffset' ]);
  }, [ resetSettings ]);

  const ModelActionMenu = useCallback((record: ModelItem) => {
    const isDeletable = user?.isAdmin || user?.id === record.userId;
    return (
      <Menu>
        <Menu.Item
          key="switch-archived"
          onClick={() => switchArchived(record)}>
          {record.archived ? 'Unarchive' : 'Archive'}
        </Menu.Item>
        <Menu.Item
          danger
          key="delete-model"
          onClick={() => isDeletable ?
            showConfirmDelete(record) : showModalItemCannotDelete()}>
          Delete Model
        </Menu.Item>
      </Menu>
    );
  }, [ showConfirmDelete, switchArchived, user?.id, user?.isAdmin ]);

  const columns = useMemo(() => {
    const tagsRenderer = (value: string, record: ModelItem) => (
      <TagList
        compact
        disabled={record.archived}
        tags={record.labels ?? []}
        onChange={(tags) => setModelTags(record.name, tags)}
      />
    );

    const actionRenderer = (_:string, record: ModelItem) => {
      return (
        <Dropdown
          overlay={() => ModelActionMenu(record)}
          trigger={[ 'click' ]}>
          <Button className={css.overflow} type="text">
            <Icon name="overflow-vertical" />
          </Button>
        </Dropdown>
      );
    };

    const descriptionRenderer = (value:string, record: ModelItem) => (
      <InlineEditor
        disabled={record.archived}
        placeholder="Add description..."
        value={value}
        onSave={(newDescription: string) => saveModelDescription(record.name, newDescription)}
      />
    );

    return [
      {
        dataIndex: 'name',
        defaultWidth: DEFAULT_COLUMN_WIDTHS['name'],
        filterDropdown: nameFilterSearch,
        filterIcon: tableSearchIcon,
        isFiltered: (settings: Settings) => !!settings.name,
        key: V1GetModelsRequestSortBy.NAME,
        onCell: onRightClickableCell,
        render: modelNameRenderer,
        sorter: true,
        title: 'Name',
      },
      {
        dataIndex: 'description',
        defaultWidth: DEFAULT_COLUMN_WIDTHS['description'],
        filterDropdown: descriptionFilterSearch,
        filterIcon: tableSearchIcon,
        isFiltered: (settings: Settings) => !!settings.description,
        key: V1GetModelsRequestSortBy.DESCRIPTION,
        render: descriptionRenderer,
        sorter: true,
        title: 'Description',
      },
      {
        dataIndex: 'numVersions',
        defaultWidth: DEFAULT_COLUMN_WIDTHS['numVersions'],
        key: V1GetModelsRequestSortBy.NUMVERSIONS,
        onCell: onRightClickableCell,
        sorter: true,
        title: 'Versions',
      },
      {
        dataIndex: 'lastUpdatedTime',
        defaultWidth: DEFAULT_COLUMN_WIDTHS['lastUpdatedTime'],
        key: V1GetModelsRequestSortBy.LASTUPDATEDTIME,
        render: (date: string) => relativeTimeRenderer(new Date(date)),
        sorter: true,
        title: 'Last updated',
      },
      {
        dataIndex: 'tags',
        defaultWidth: DEFAULT_COLUMN_WIDTHS['tags'],
        filterDropdown: labelFilterDropdown,
        filters: tags.map(tag => ({ text: tag, value: tag })),
        isFiltered: (settings: Settings) => !!settings.tags,
        key: 'tags',
        render: tagsRenderer,
        title: 'Tags',
      },
      {
        dataIndex: 'archived',
        defaultWidth: DEFAULT_COLUMN_WIDTHS['archived'],
        key: 'archived',
        render: checkmarkRenderer,
        title: 'Archived',
      },
      {
        dataIndex: 'user',
        defaultWidth: DEFAULT_COLUMN_WIDTHS['user'],
        filterDropdown: userFilterDropdown,
        filters: users.map(user => ({ text: getDisplayName(user), value: user.id })),
        isFiltered: (settings: Settings) => !!settings.users,
        key: 'user',
        render: userRenderer,
        title: 'User',
      },
      {
        align: 'right',
        className: 'fullCell',
        dataIndex: 'action',
        defaultWidth: DEFAULT_COLUMN_WIDTHS['action'],
        fixed: 'right',
        key: 'action',
        render: actionRenderer,
        title: '',
        width: DEFAULT_COLUMN_WIDTHS['action'],
      },
    ] as ColumnDef<ModelItem>[];
  }, [ nameFilterSearch,
    tableSearchIcon,
    descriptionFilterSearch,
    labelFilterDropdown,
    tags,
    userFilterDropdown,
    users,
    setModelTags,
    ModelActionMenu,
    saveModelDescription ]);

  const handleTableChange = useCallback((tablePagination, tableFilters, tableSorter) => {
    if (Array.isArray(tableSorter)) return;

    const { columnKey, order } = tableSorter as SorterResult<ModelItem>;
    if (!columnKey || !columns.find(column => column.key === columnKey)) return;

    const newSettings = {
      sortDesc: order === 'descend',
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      sortKey: columnKey as any,
      tableLimit: tablePagination.pageSize,
      tableOffset: (tablePagination.current - 1) * tablePagination.pageSize,
    };
    const shouldPush = settings.tableOffset !== newSettings.tableOffset;
    updateSettings(newSettings, shouldPush);
  }, [ columns, settings.tableOffset, updateSettings ]);

  useEffect(() => {
    return () => canceler.abort();
  }, [ canceler ]);

  const showCreateModelModal = useCallback(() => {
    showModal({});
  }, [ showModal ]);

  const switchShowArchived = useCallback((showArchived: boolean) => {
    let newColumns: ModelColumnName[];
    let newColumnWidths: number[];

    if (showArchived) {
      if (settings.columns?.includes('archived')) {
        // just some defensive coding: don't add archived twice
        newColumns = settings.columns;
        newColumnWidths = settings.columnWidths;
      } else {
        newColumns = [ ...settings.columns, 'archived' ];
        newColumnWidths = [ ...settings.columnWidths, DEFAULT_COLUMN_WIDTHS['archived'] ];
      }
    } else {
      const archivedIndex = settings.columns.indexOf('archived');
      if (archivedIndex !== -1) {
        newColumns = [ ...settings.columns ];
        newColumnWidths = [ ...settings.columnWidths ];
        newColumns.splice(archivedIndex, 1);
        newColumnWidths.splice(archivedIndex, 1);
      } else {
        newColumns = settings.columns;
        newColumnWidths = settings.columnWidths;
      }
    }
    updateSettings({
      archived: showArchived,
      columns: newColumns,
      columnWidths: newColumnWidths,
      row: undefined,
    });

  }, [ settings, updateSettings ]);

  const ModelActionDropdown = useCallback(
    ({ record, onVisibleChange, children }) => (
      <Dropdown
        overlay={() => ModelActionMenu(record)}
        trigger={[ 'contextMenu' ]}
        onVisibleChange={onVisibleChange}>
        {children}
      </Dropdown>
    ),
    [ ModelActionMenu ],
  );

  return (
    <Page
      containerRef={pageRef}
      id="models"
      loading={isLoading}
      options={(
        <Space>
          <Switch checked={settings.archived} onChange={switchShowArchived} />
          <Label type={LabelTypes.TextOnly}>Show Archived</Label>
          <Button onClick={resetColumnWidths}>Reset Widths</Button>
          {filterCount > 0 &&
            <FilterCounter activeFilterCount={filterCount} onReset={resetFilters} />}
          <Button onClick={showCreateModelModal}>New Model</Button>
        </Space>
      )}
      title="Model Registry">
      {(models.length === 0 && !isLoading && filterCount === 0) ?
        (
          <div className={css.emptyBase}>
            <div className={css.icon}>
              <Icon name="model" size="mega" />
            </div>
            <h4>No Models Registered</h4>
            <p className={css.description}>
              Track important checkpoints and versions from your experiments.&nbsp;
              <Link external path={paths.docs('/post-training/model-registry.html')}>
                Learn more
              </Link>
            </p>
          </div>
        ) : (
          <InteractiveTable
            columns={columns}
            containerRef={pageRef}
            ContextMenu={ModelActionDropdown}
            dataSource={models}
            loading={isLoading}
            pagination={getFullPaginationConfig({
              limit: settings.tableLimit,
              offset: settings.tableOffset,
            }, total)}
            rowClassName={defaultRowClassName({ clickable: false })}
            rowKey="name"
            settings={settings as InteractiveTableSettings}
            showSorterTooltip={false}
            size="small"
            updateSettings={updateSettings as UpdateSettings<InteractiveTableSettings>}
            onChange={handleTableChange}
          />
        )}
    </Page>
  );
};

export default ModelRegistry;
