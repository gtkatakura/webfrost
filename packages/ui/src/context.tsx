import { WebFrostClient } from "@webfrost/sdk";
import { createContext, useContext } from "react";

// The UI is served by the server it talks to: same origin, so no base URL.
export const defaultClient = new WebFrostClient();

export const ClientContext = createContext<WebFrostClient>(defaultClient);

export function useClient(): WebFrostClient {
  return useContext(ClientContext);
}
