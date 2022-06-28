import { Alert, Tabs } from 'antd';
import queryString from 'query-string';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import Link from 'components/Link';
import { useStore } from 'contexts/Store';
import { paths } from 'routes/utils';
import {
  V1MetricNamesResponse, V1TrialsSampleResponse,
} from 'services/api-ts-sdk';
import { detApi } from 'services/apiConfig';
import { readStream } from 'services/utils';
import Message, { MessageType } from 'shared/components/Message';
import Spinner from 'shared/components/Spinner/Spinner';
import { Primitive } from 'shared/types';
import { hasObjectKeys, isEqual } from 'shared/utils/data';
import { flattenObject } from 'shared/utils/data';
import {
  ExperimentVisualizationType,
  HpImportanceMap, Hyperparameter,
  HyperparameterType, MetricName, MetricType, metricTypeParamMap,
} from 'types';
import { Scale } from 'types';
import { alphaNumericSorter, hpImportanceSorter } from 'utils/sort';

import css from './CompareVisualization.module.scss';
import CompareCurve from './CompareVisualization/CompareCurve';
import ExperimentVisualizationFilters, {
  MAX_HPARAM_COUNT, ViewType, VisualizationFilters,
} from './CompareVisualization/CompareFilters';
import { TrialHParams } from './CompareVisualization/CompareTable';

enum PageError {
  MetricBatches,
  MetricHpImportance,
  MetricNames,
  ExperimentSample
}
export type HpValsMap = Record<string, Set<Primitive>>

const DEFAULT_TYPE_KEY = ExperimentVisualizationType.LearningCurve;
const DEFAULT_BATCH = 0;
const DEFAULT_BATCH_MARGIN = 10;
const DEFAULT_MAX_TRIALS = 100;
const DEFAULT_VIEW = ViewType.Grid;
const PAGE_ERROR_MESSAGES = {
  [PageError.MetricBatches]: 'Unable to retrieve experiment batches info.',
  [PageError.MetricHpImportance]: 'Unable to retrieve experiment hp importance.',
  [PageError.MetricNames]: 'Unable to retrieve experiment metric info.',
  [PageError.ExperimentSample]: 'Unable to retrieve experiment info.',
};
const CompareVisualization: React.FC = () => {

  const { ui } = useStore();
  //const storage = useStorage(`${STORAGE_PATH}/${experiment.id}`);

  const fullHParams = useRef<string[]>(
    [],
  );

  // const asd = useMemo(() => {
  //   const experimentHps = experiments.map(e => new Set(Object.keys(e.hyperparameters ?? {})))
  //   const allHParams = experimentHps.reduce(union)
  //   const differingHParams = [].filter(hp => {
  //     const allHpVals = experiments.map(e => e.hyperparameters[hp] )
  //   })

  // }, [])

  // Hack to show exp data
  const defaultMetric = useMemo(() => ({
    // name: experiments?.[0]?.config.searcher.metric,
    name: 'validation_loss',
    type: MetricType.Validation,
  }), []);

  const searcherMetric = useRef<MetricName>(defaultMetric);
  const defaultFilters: VisualizationFilters = {
    batch: DEFAULT_BATCH,
    batchMargin: DEFAULT_BATCH_MARGIN,
    hParams: [],
    maxTrial: DEFAULT_MAX_TRIALS,
    metric: searcherMetric.current,
    scale: Scale.Linear,
    view: DEFAULT_VIEW,
  };

  const location = useLocation();

  const experimentIds: number[] = useMemo(() => {
    const query = queryString.parse(location.search);
    if(query.id && typeof query.id === 'string'){
      return [ parseInt(query.id) ];

    } else if(Array.isArray(query.id)){
      return query.id.map(x => parseInt(x));
    }
    return [];

  }, [ location.search ]);

  const [ filters, setFilters ] = useState<VisualizationFilters>(defaultFilters);
  const [ batches, setBatches ] = useState<number[]>([]);
  const [ metrics, setMetrics ] = useState<MetricName[]>([]);
  const [ hpImportanceMap ] = useState<HpImportanceMap>();
  const [ pageError, setPageError ] = useState<PageError>();

  //
  const [ trialIds, setTrialIds ] = useState<number[]>([]);
  const [ chartData, setChartData ] = useState<(number | null)[][]>([]);
  const [ trialHps, setTrialHps ] = useState<TrialHParams[]>([]);

  const [ hyperparameters, setHyperparameters ] = useState<Record<string, Hyperparameter>>({});
  const [ hpVals, setHpVals ] = useState<HpValsMap>({});
  const typeKey = DEFAULT_TYPE_KEY;
  const { hasData, isSupported, hasLoaded } = useMemo(() => {
    return {
      hasData: (batches && batches.length !== 0) ||
      (metrics && metrics.length !== 0) ||
      (trialIds && trialIds.length > 0),
      hasLoaded: batches.length > 0 ||
      metrics && metrics.length > 0 ||
      trialIds.length > 0,
      isSupported: true,
    };
  }, [ batches, metrics, trialIds ]);

  const hpImportance = useMemo(() => {
    if (!hpImportanceMap) return {};
    return hpImportanceMap[filters.metric.type][filters.metric.name] || {};
  }, [ filters.metric, hpImportanceMap ]);

  const handleFiltersChange = useCallback((filters: VisualizationFilters) => {
    setFilters(filters);
  }, [ ]);

  useEffect(() => {
    if(!filters.metric?.name && trialIds.length){
      setFilters({
        batch: DEFAULT_BATCH,
        batchMargin: DEFAULT_BATCH_MARGIN,
        hParams: [],
        maxTrial: DEFAULT_MAX_TRIALS,
        metric: defaultMetric,
        scale: Scale.Linear,
        view: DEFAULT_VIEW,
      });
    }
  }, [ trialIds, defaultMetric, filters.metric?.name ]);

  useEffect(() => {
    if (ui.isPageHidden || !experimentIds.length) return;

    const canceler = new AbortController();
    const trialIdsMap: Record<number, number> = {};
    const trialDataMap: Record<number, number[]> = {};
    const trialHpMap: Record<number, TrialHParams> = {};
    const hpValsMap: HpValsMap = {};
    const batchesMap: Record<number, number> = {};
    const metricsMap: Record<number, Record<number, number>> = {};
    const hyperparameters: Record<string, Hyperparameter> = {};
    const metricTypeParam = metricTypeParamMap[filters.metric.type];

    readStream<V1TrialsSampleResponse>(
      detApi.StreamingInternal.experimentsSample(
        experimentIds,
        filters.metric.name,
        metricTypeParam,
        filters.maxTrial,
        undefined,
        undefined,
        undefined,
        undefined,
        { signal: canceler.signal },
      ),
      event => {
        if (!event || !event.trials) return;

        /*
         * Cache trial ids, hparams, batches and metric values into easily searchable
         * dictionaries, then construct the necessary data structures to render the
         * chart and the table.
         */

        (event.promotedTrials || []).forEach(trialId => trialIdsMap[trialId] = trialId);
        // (event.demotedTrials || []).forEach(trialId => delete trialIdsMap[trialId]);
        const newTrialIds = Object.values(trialIdsMap);
        setTrialIds(prevTrialIds =>
          isEqual(prevTrialIds, newTrialIds)
            ? prevTrialIds
            : newTrialIds);

        (event.trials || []).forEach(trial => {
          const id = trial.trialId;
          const flatHParams = flattenObject(trial.hparams || {});
          Object.keys(flatHParams).forEach(
            (hpParam) => {
              // distinguishing between constant vs not is irrelevant when constant
              // hps can vary across experiments. placeholder code
              (hyperparameters[hpParam] = { type: HyperparameterType.Constant });
              //
              if (hpValsMap[hpParam] == null) {
                hpValsMap[hpParam] = new Set([ flatHParams[hpParam] ]);
              } else {
                hpValsMap[hpParam].add(flatHParams[hpParam]);
              }
            },
          );
          setHyperparameters(hyperparameters);
          const hasHParams = Object.keys(flatHParams).length !== 0;

          if (hasHParams && !trialHpMap[id]) {
            trialHpMap[id] = {
              experimentId: trial.experimentId,
              hparams: flatHParams,
              id,
              metric: null,
            };
          }

          trialDataMap[id] = trialDataMap[id] || [];
          metricsMap[id] = metricsMap[id] || {};

          trial.data.forEach(datapoint => {
            batchesMap[datapoint.batches] = datapoint.batches;
            metricsMap[id][datapoint.batches] = datapoint.value;
            trialHpMap[id].metric = datapoint.value;
          });
        });

        Object.keys(hpValsMap).forEach(hpParam => {
          const hpVals = hpValsMap[hpParam];
          if (!hpVals.has('-') && newTrialIds.some(id => trialHpMap[id] == null)) {
            hpValsMap[hpParam].add('-');
          }
        });
        setHpVals(hpValsMap);

        const newTrialHps = newTrialIds.map(id => trialHpMap[id]);
        setTrialHps(newTrialHps);

        const newBatches = Object.values(batchesMap);
        setBatches(newBatches);

        const newChartData = newTrialIds.map(trialId => newBatches.map(batch => {
          /**
           * TODO: filtering NaN, +/- Infinity for now, but handle it later with
           * dynamic min/max ranges via uPlot.Scales.
           */
          const value = metricsMap[trialId][batch];
          return Number.isFinite(value) ? value : null;
        }));
        setChartData(newChartData);

        // One successful event as come through.
      },
    ).catch(e => {
      setPageError(e);
    });

    return () => canceler.abort();
  }, [ trialIds, filters.metric, ui.isPageHidden, filters.maxTrial, experimentIds ]);

  useEffect(() => {
    if (!isSupported || ui.isPageHidden || !trialIds?.length) return;

    const canceler = new AbortController();
    const trainingMetricsMap: Record<string, boolean> = {};
    const validationMetricsMap: Record<string, boolean> = {};

    readStream<V1MetricNamesResponse>(
      detApi.StreamingInternal.trialsMetricNames(
        trialIds,
        undefined,
        { signal: canceler.signal },
      ),
      event => {
        if (!event) return;
        /*
         * The metrics endpoint can intermittently send empty lists,
         * so we keep track of what we have seen on our end and
         * only add new metrics we have not seen to the list.
         */
        (event.trainingMetrics || []).forEach(metric => trainingMetricsMap[metric] = true);
        (event.validationMetrics || []).forEach(metric => validationMetricsMap[metric] = true);

        const newTrainingMetrics = Object.keys(trainingMetricsMap).sort(alphaNumericSorter);
        const newValidationMetrics = Object.keys(validationMetricsMap).sort(alphaNumericSorter);
        const newMetrics = [
          ...(newValidationMetrics || []).map(name => ({ name, type: MetricType.Validation })),
          ...(newTrainingMetrics || []).map(name => ({ name, type: MetricType.Training })),
        ];
        setMetrics(newMetrics);
      },
    ).catch(() => {
      setPageError(PageError.MetricNames);
    });

    return () => canceler.abort();
  }, [ trialIds, filters?.metric, isSupported, ui.isPageHidden ]);

  // Set the default filter batch.
  useEffect(() => {
    if (!batches || batches.length === 0) return;
    setFilters(prev => {
      if (prev.batch !== DEFAULT_BATCH) return prev;
      return { ...prev, batch: batches.first() };
    });
  }, [ batches ]);

  // Update default filter hParams if not previously set.
  useEffect(() => {
    if (!isSupported) return;

    setFilters(prev => {
      if (prev.hParams.length !== 0 || !hpImportanceMap) return prev;
      const map = hpImportanceMap[prev.metric.type][prev.metric.name];
      let hParams = fullHParams.current;
      if (hasObjectKeys(map)) {
        hParams = hParams.sortAll((a, b) => hpImportanceSorter(a, b, map));
      }
      return { ...prev, hParams: hParams.slice(0, MAX_HPARAM_COUNT) };
    });
  }, [ hpImportanceMap, isSupported ]);

  if (!experimentIds.length) {
    return (
      <div className={css.alert}>
        <Spinner center className={css.alertSpinner} />
      </div>
    );
  }if (!isSupported) {
    const alertMessage = `
      Hyperparameter visualizations are not applicable for single trial or PBT experiments.
    `;
    return (
      <div className={css.alert}>
        <Alert
          description={(
            <>
              Learn about&nbsp;
              <Link
                external
                path={paths.docs('/training-apis/experiment-config.html#searcher')}
                popout>how to run a hyperparameter search
              </Link>.
            </>
          )}
          message={alertMessage}
          type="warning"
        />
      </div>
    );
  } else if (pageError) {
    return <Message title={PAGE_ERROR_MESSAGES[pageError]} type={MessageType.Alert} />;
  }

  const visualizationFilters = (
    <ExperimentVisualizationFilters
      batches={batches || []}
      filters={filters}
      fullHParams={fullHParams.current}
      hpImportance={hpImportance}
      metrics={metrics || []}
      type={typeKey}
      onChange={handleFiltersChange}
    />
  );

  return (
    <div className={css.base}>
      <Tabs
        activeKey={typeKey}
        destroyInactiveTabPane
        type="card">
        <Tabs.TabPane
          key={ExperimentVisualizationType.LearningCurve}
          tab="Learning Curve">
          {(experimentIds.length > 0 && filters.metric?.name && (
            <CompareCurve
              batches={batches}
              chartData={chartData}
              filters={visualizationFilters}
              hasLoaded={hasLoaded}
              hpVals={hpVals}
              hyperparameters={hyperparameters}
              selectedMaxTrial={filters.maxTrial}
              selectedMetric={filters.metric}
              selectedScale={filters.scale}
              trialHps={trialHps}
              trialIds={trialIds}
            />
          ))}
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
};

export default CompareVisualization;
