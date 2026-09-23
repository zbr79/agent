"use client";

import { Toaster } from "react-hot-toast";

export default function AppToaster() {
  return (
    <Toaster
      position="top-center"
      toastOptions={{
        duration: 2500,
        className: "toast",
        success: { className: "toast toast-success" },
        error: { className: "toast toast-error" },
        loading: { className: "toast toast-info" },
      }}
    />
  );
}
