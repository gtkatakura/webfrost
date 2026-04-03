import { WebFrostClient } from "@webfrost/sdk";
import { createContext, useContext } from "react";

export const defaultClient = new WebFrostClient({ baseUrl: "/api" });

export const ClientContext = createContext<WebFrostClient>(defaultClient);

export function useClient(): WebFrostClient {
  return useContext(ClientContext);
}
