export type GlobalRailState = {
  historyExpanded: boolean;
  sourcesExpanded: boolean;
  sourcesManuallyToggled: boolean;
};

export type GlobalRailEvent =
  | { type: "toggle-history" }
  | { type: "toggle-sources" }
  | { type: "citations-changed"; previousCount: number; nextCount: number };

export function createGlobalRailState(citationCount: number): GlobalRailState {
  return {
    historyExpanded: true,
    sourcesExpanded: citationCount > 0,
    sourcesManuallyToggled: false
  };
}

export function reduceGlobalRailState(state: GlobalRailState, event: GlobalRailEvent): GlobalRailState {
  switch (event.type) {
    case "toggle-history":
      return { ...state, historyExpanded: !state.historyExpanded };
    case "toggle-sources":
      return {
        ...state,
        sourcesExpanded: !state.sourcesExpanded,
        sourcesManuallyToggled: true
      };
    case "citations-changed":
      if (!state.sourcesManuallyToggled && event.previousCount === 0 && event.nextCount > 0) {
        return { ...state, sourcesExpanded: true };
      }
      return state;
  }
}
