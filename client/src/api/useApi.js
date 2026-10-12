import { useCallback, useEffect, useState } from 'react';
import { api } from './http.js';

// Load one endpoint. Pass null as the path to skip the request (e.g. no permission).
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });

  const load = useCallback(async () => {
    if (!path) return setState({ data: null, error: null, loading: false });
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ data: await api.get(path), error: null, loading: false });
    } catch (error) {
      setState({ data: null, error, loading: false });
    }
  }, [path]);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
