import { toast } from "react-hot-toast";

const MAX_TOASTS = 3;
const toastQueue: string[] = [];
const HARD_CLOSE_MS = 2500;

function pushToast(id: string) {
  toastQueue.push(id);

  if (toastQueue.length > MAX_TOASTS) {
    const oldest = toastQueue.shift();
    if (oldest) toast.dismiss(oldest);
  }
}

function showToast(create: () => string) {
  const id = create();
  pushToast(id);
  setTimeout(() => {
    toast.dismiss(id);
  }, HARD_CLOSE_MS);
}

export const toastSuccess = (message: string) => {
  showToast(() => toast.success(message));
};

export const toastError = (message: string) => {
  showToast(() => toast.error(message));
};

export const toastInfo = (message: string) => {
  showToast(() => toast(message));
};

export const toastWarning = (message: string) => {
  showToast(() => toast.error(message));
};
