import {
  createReadingFlow,
  isSupportedReadingDocument,
  type ReadingFlow,
} from '../src/modules/reading-flow/create-reading-flow';

const runtimeKey = '__lingoPaletteReadingFlow__';

type ReadingFlowWindow = Window & {
  [runtimeKey]?: ReadingFlow;
};

export default defineUnlistedScript(() => {
  if (!isSupportedReadingDocument(window)) return;
  const currentWindow = window as ReadingFlowWindow;
  currentWindow[runtimeKey]?.dispose();
  const readingFlow = createReadingFlow(window, document);
  readingFlow.mount();
  currentWindow[runtimeKey] = readingFlow;
});
