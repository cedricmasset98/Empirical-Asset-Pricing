declare module 'plotly.js-dist-min' {
  // Typage minimal : le bundle « dist-min » ne fournit pas ses propres types.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const Plotly: {
    react(el: HTMLElement, data: any[], layout?: any, config?: any): Promise<unknown>;
    purge(el: HTMLElement): void;
    Plots: { resize(el: HTMLElement): void };
  };
  export default Plotly;
}
