import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';

import Page from 'components/Page';
import { terminalRunStates } from 'constants/states';
import { useStore } from 'contexts/Store';
import usePolling from 'hooks/usePolling';
import ExperimentDetailsHeader from 'pages/ExperimentDetails/ExperimentDetailsHeader';
import {
  getExperimentDetails, getExpValidationHistory, isNotFound,
} from 'services/api';
import Message, { MessageType } from 'shared/components/Message';
import Spinner from 'shared/components/Spinner/Spinner';
import { isEqual } from 'shared/utils/data';
import { ExperimentBase, TrialDetails, ValidationHistory } from 'types';
import { isSingleTrialExperiment } from 'utils/experiment';

import { isAborted } from '../shared/utils/service';

import ExperimentMultiTrialTabs from './ExperimentDetails/ExperimentMultiTrialTabs';
import ExperimentSingleTrialTabs from './ExperimentDetails/ExperimentSingleTrialTabs';

interface Params {
  experimentId: string;
}

const ExperimentDetails: React.FC = () => {
  const { experimentId } = useParams<Params>();
  const { auth: { user } } = useStore();
  const [ canceler ] = useState(new AbortController());
  const [ experiment, setExperiment ] = useState<ExperimentBase>();
  const [ trial, setTrial ] = useState<TrialDetails>();
  /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
  const [ valHistory, setValHistory ] = useState<ValidationHistory[]>([]);
  const [ pageError, setPageError ] = useState<Error>();
  const [ isSingleTrial, setIsSingleTrial ] = useState<boolean>();
  const pageRef = useRef<HTMLElement>(null);

  const id = parseInt(experimentId);

  const fetchExperimentDetails = useCallback(async () => {
    try {
      const [ newExperiment, newValHistory ] = await Promise.all([
        getExperimentDetails({ id }, { signal: canceler.signal }),
        getExpValidationHistory({ id }, { signal: canceler.signal }),
      ]);
      setExperiment((prevExperiment) =>
        isEqual(prevExperiment, newExperiment) ? prevExperiment : newExperiment);
      setValHistory((prevValHistory) =>
        isEqual(prevValHistory, newValHistory) ? prevValHistory : newValHistory);
      setIsSingleTrial(
        isSingleTrialExperiment(newExperiment),
      );
    } catch (e) {
      if (!pageError && !isAborted(e)) setPageError(e as Error);
    }
  }, [
    id,
    canceler.signal,
    pageError,
  ]);

  const { stopPolling } = usePolling(fetchExperimentDetails, { rerunOnNewFn: true });

  const handleSingleTrialUpdate = useCallback((trial: TrialDetails) => {
    setTrial(trial);
  }, []);

  useEffect(() => {
    if (experiment && terminalRunStates.has(experiment.state)) {
      stopPolling();
    }
  }, [ experiment, stopPolling ]);

  useEffect(() => {
    fetchExperimentDetails();
  }, [ fetchExperimentDetails ]);

  useEffect(() => {
    return () => canceler.abort();
  }, [ canceler ]);

  if (isNaN(id)) {
    return <Message title={`Invalid Experiment ID ${experimentId}`} />;
  } else if (pageError) {
    const message = isNotFound(pageError) ?
      `Unable to find Experiment ${experimentId}` :
      `Unable to fetch Experiment ${experimentId}`;
    return <Message title={message} type={MessageType.Warning} />;
  } else if (!experiment || isSingleTrial === undefined) {
    return <Spinner tip={`Loading experiment ${experimentId} details...`} />;
  }

  return (
    <Page
      bodyNoPadding
      containerRef={pageRef}
      headerComponent={(
        <ExperimentDetailsHeader
          curUser={user}
          experiment={experiment}
          fetchExperimentDetails={fetchExperimentDetails}
          trial={trial}
        />
      )}
      stickyHeader
      title={`Experiment ${experimentId}`}>
      {isSingleTrial ? (
        <ExperimentSingleTrialTabs
          experiment={experiment}
          fetchExperimentDetails={fetchExperimentDetails}
          pageRef={pageRef}
          onTrialUpdate={handleSingleTrialUpdate}
        />
      ) : (
        <ExperimentMultiTrialTabs
          experiment={experiment}
          fetchExperimentDetails={fetchExperimentDetails}
          pageRef={pageRef}
        />
      )}
    </Page>
  );
};

export default ExperimentDetails;
