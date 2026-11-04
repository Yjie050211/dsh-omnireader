import { createContext, useContext } from 'react'

export const OmniContext = createContext({
  t: (key) => key,
  store: null,
  openInReader: () => {},
  openExternal: () => {},
})

export function useT() {
  return useContext(OmniContext).t
}
