/* global Telegram */

const tg = window.Telegram?.WebApp;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const API_BASE_URL =
  window.APP_CONFIG?.apiBaseUrl || window.location.origin;

const elements = {
  uploadZone: document.querySelector("#uploadZone"),
  imageInput: document.querySelector("#imageInput"),
  uploadTitle: document.querySelector("#uploadTitle"),
  uploadSubtitle: document.querySelector("#uploadSubtitle"),
  previewWrap: document.querySelector("#previewWrap"),
  previewImage: document.querySelector("#previewImage"),
  removeImage: document.querySelector("#removeImage"),
  nickname: document.querySelector("#nickname"),
  nicknameError: document.querySelector("#nicknameError"),
  characterCounter: document.querySelector("#characterCounter"),
  payButton: document.querySelector("#payButton"),
  payButtonLabel: document.querySelector("#payButtonLabel"),
  buttonSpinner: document.querySelector("#buttonSpinner"),
  statusMessage: document.querySelector("#statusMessage"),
};

let selectedFile = null;
let previewUrl = null;

function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.setHeaderColor("#0d1117");
  tg.setBackgroundColor("#0d1117");
}

function setStatus(message, isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle("is-error", isError);
}

function setLoading(isLoading) {
  elements.payButton.disabled = isLoading || !isFormValid();
  elements.buttonSpinner.classList.toggle("is-hidden", !isLoading);
  elements.payButtonLabel.classList.toggle("is-hidden", isLoading);
  if (isLoading) {
    elements.payButtonLabel.textContent = "Создаём заказ…";
  } else {
    updatePayButtonLabel();
  }
}

function isFormValid() {
  return Boolean(selectedFile && elements.nickname.value.trim().length > 0);
}

function updatePayButtonLabel() {
  if (!selectedFile) {
    elements.payButtonLabel.textContent = "Загрузите фото и укажите ник";
  } else if (!elements.nickname.value.trim()) {
    elements.payButtonLabel.textContent = "Укажите никнейм";
  } else {
    elements.payButtonLabel.textContent = "Оплатить $0.65";
  }
  elements.payButton.disabled = !isFormValid();
}

function validateFile(file) {
  if (!file) return "Файл не выбран.";
  if (!ALLOWED_TYPES.has(file.type)) {
    return "Поддерживаются только JPG, PNG и WebP.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "Файл слишком большой. Максимальный размер — 10 МБ.";
  }
  return "";
}

function showSelectedFile(file) {
  const error = validateFile(file);
  if (error) {
    setStatus(error, true);
    return;
  }

  selectedFile = file;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  elements.previewImage.src = previewUrl;
  elements.previewWrap.classList.remove("is-hidden");
  elements.uploadZone.classList.add("is-hidden");
  elements.uploadTitle.textContent = file.name;
  elements.uploadSubtitle.textContent = `${Math.ceil(file.size / 1024)} КБ`;
  setStatus("");
  updatePayButtonLabel();
}

function clearFile() {
  selectedFile = null;
  elements.imageInput.value = "";
  elements.previewImage.removeAttribute("src");
  elements.previewWrap.classList.add("is-hidden");
  elements.uploadZone.classList.remove("is-hidden");
  elements.uploadTitle.textContent = "Выбрать фото";
  elements.uploadSubtitle.textContent = "Максимальный размер — 10 МБ";
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  updatePayButtonLabel();
}

function updateNickname() {
  const value = elements.nickname.value;
  elements.characterCounter.textContent = `${value.length}/20`;
  elements.nicknameError.classList.add("is-hidden");
  setStatus("");
  updatePayButtonLabel();
}

async function createOrder() {
  if (!selectedFile || !elements.nickname.value.trim()) return;

  const formData = new FormData();
  formData.append("image", selectedFile, selectedFile.name);
  formData.append("nickname", elements.nickname.value.trim());

  // Сервер должен проверить Telegram.WebApp.initData самостоятельно.
  // Не доверяйте user id, присланному из обычного JSON тела запроса.
  formData.append("telegramInitData", tg?.initData || "");

  setLoading(true);
  setStatus("Готовим заказ…");

  try {
    const response = await fetch(`${API_BASE_URL}/api/orders`, {
      method: "POST",
      body: formData,
      headers: { Accept: "application/json" },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || "Не удалось создать заказ.");
    }

    if (!payload.paymentUrl) {
      throw new Error("Сервер не вернул ссылку на оплату.");
    }

    setStatus("Перенаправляем на оплату…");
    if (tg?.openLink) {
      tg.openLink(payload.paymentUrl);
    } else {
      window.location.assign(payload.paymentUrl);
    }
  } catch (error) {
    setStatus(error.message || "Произошла ошибка. Попробуйте ещё раз.", true);
    setLoading(false);
  }
}

elements.imageInput.addEventListener("change", (event) => {
  showSelectedFile(event.target.files?.[0]);
});

elements.removeImage.addEventListener("click", clearFile);
elements.nickname.addEventListener("input", updateNickname);
elements.payButton.addEventListener("click", createOrder);

["dragenter", "dragover"].forEach((eventName) => {
  elements.uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.uploadZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.uploadZone.classList.remove("is-dragging");
  });
});

elements.uploadZone.addEventListener("drop", (event) => {
  showSelectedFile(event.dataTransfer.files?.[0]);
});

initTelegram();
updatePayButtonLabel();