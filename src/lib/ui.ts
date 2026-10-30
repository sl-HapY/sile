import { useStore } from "./store";

/**
 * Promise-based custom dialogs (WebView has no window.prompt/confirm/alert).
 */

export function confirmDialog(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    useStore.getState().openModal("confirm", { title, message, resolve });
  });
}

export function promptDialog(
  title: string,
  label: string,
  initial = ""
): Promise<string | null> {
  return new Promise((resolve) => {
    useStore.getState().openModal("prompt", { title, label, initial, resolve });
  });
}

export function alertDialog(title: string, message: string): Promise<void> {
  return new Promise((resolve) => {
    useStore.getState().openModal("alert", { title, message, resolve });
  });
}
