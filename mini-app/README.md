# Avatar Editor — Telegram Mini App

Статический frontend для Telegram Mini App. Он не содержит токенов и не
подключается к CryptoBot/Xrocket напрямую: платежи должен создавать только
backend.

## Файлы

- `index.html` — разметка и подключение Telegram Web App SDK.
- `styles.css` — мобильный интерфейс.
- `script.js` — загрузка файла, предпросмотр, валидация и запрос заказа.

## Контракт backend

Frontend отправляет `POST /api/orders` как `multipart/form-data`:

- `image` — JPG/PNG/WebP, до 10 МБ;
- `nickname` — строка до 20 символов;
- `telegramInitData` — строка из `Telegram.WebApp.initData`.

Ожидаемый успешный ответ:

```json
{
  "orderId": "order_123",
  "paymentUrl": "https://t.me/CryptoBot?start=..."
}
```

По умолчанию запрос идёт на тот же домен, где открыт Mini App. Для отдельного
домена можно перед деплоем добавить перед `script.js`:

```html
<script>
  window.APP_CONFIG = { apiBaseUrl: "https://api.example.com" };
</script>
```

Если frontend и backend находятся на разных доменах, на backend понадобится
CORS только для конкретного домена Mini App, а не `*`.

## Локальный просмотр

Из корня проекта:

```bash
python3 -m http.server 8080 -d mini-app
```

Обычный браузерный просмотр покажет интерфейс, но `initData` будет пустым —
настоящую проверку нужно делать внутри Telegram.