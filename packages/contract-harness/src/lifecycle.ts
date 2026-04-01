export interface Shutdownable {
  shutdown(): Promise<void>;
}

export interface Disconnectable {
  disconnect(): void;
}

export function isShutdownable(obj: unknown): obj is Shutdownable {
  return typeof obj === "object" && obj !== null && typeof (obj as Shutdownable).shutdown === "function";
}

export function isDisconnectable(obj: unknown): obj is Disconnectable {
  return typeof obj === "object" && obj !== null && typeof (obj as Disconnectable).disconnect === "function";
}
