@AGENTS.md


# Правила для коду

1. Лінтер з `eslint.config.mjs` є єдиним джерелом правил якості, зокрема SOLID (плагін `solid-principles`). Числові ліміти тут не дублюються: бери їх з конфігу.
2. Після кожної зміни в `app/`, `components/`, `lib/`, `server/src/`, `proxy.ts` запускай лише по змінених файлах: `npx eslint <шляхи файлів>`. Не запускай eslint по всьому репозиторію.
3. Виправляй усі warnings і errors у рядках, які ти написав чи змінив, за підказкою рядка й правила з виводу лінтера. Наявні warnings в інших місцях не чіпай, якщо це не твоє завдання.
4. Не лінтуй і не редагуй згенероване та сторонні файли: `server/generated`, `lib/generated`, `tmp`, `profiles`, `node_modules`, `components/ui`, `.next`.
5. Перед завершенням для змін на сервері: `npx tsc --noEmit -p server` і `npm run test:api`. Окремо скажи, що падало ще до тебе, а що нове.
6. Код публікації заморожено, див. розділ «Publish freeze» нижче. Правила 2 і 3 (eslint, SOLID) на заморожені файли не поширюються.

## Publish freeze

Код публікації заморожено. Він працює, і зайві правки в ньому ламають автопост.

**Заморожені шляхи:**
- `server/src/lib/wallapop-publish/**`
- `server/src/lib/wallapop-autopost/**`
- `server/src/routes/product-publish-*.ts`
- тести: `server/tests/wallapop-publish*.test.ts`, `server/tests/wallapop-autopost*.test.ts`, `server/tests/category-menu.test.ts`
- фікстури: `server/tests/fixtures/wallapop-envio-form.html`, `wallapop-marca-form.html`, `wallapop-tsl-catalog-item.html`

**Змінювати їх можна лише коли:**
1. Wallapop змінив верстку і публікація зламалась, і є доказ (dry-run або фікстура), або
2. Yurii прямо написав «розморозь publish».

В усіх інших випадках зупинись і запитай. Не чіпай ці файли «заодно»: рефакторинг, SOLID-правки, виправлення eslint-warnings, перейменування й форматування до цього не належать. Наявні warnings у цих файлах лишаються.

**Замок.** Хук `.claude/hooks/publish-freeze.mjs` (PreToolUse на Edit/Write/MultiEdit/Bash) блокує запис у ці шляхи, поки в корені репозиторію немає файла `.publish-unlocked`. Файл у `.gitignore`.
- **Агент не створює `.publish-unlocked`.** Хук блокує це і через Write/Edit/MultiEdit, і через Bash (`touch`, `New-Item`, `ni`, `echo >`, `Set-Content` тощо), навіть коли публікація вже розморожена. Розморозити може лише користувач: створи `.publish-unlocked` сам у терміналі.
- Розморозити (користувач, у своєму терміналі): `New-Item .publish-unlocked -ItemType File` (PowerShell) або `touch .publish-unlocked`.
- Заморозити назад: `Remove-Item .publish-unlocked` або `rm .publish-unlocked` (видалення хук не блокує). Видали файл одразу після правки.
- Якщо потрібна правка, а файла немає: зупинись і скажи Yurii, що треба розморозити.
- Для Bash хук наближений: блокує команду, що називає заморожений шлях і виглядає як запис (`sed -i`, `>`, `mv`, `git checkout` тощо). Читання (`cat`, `grep`, `git diff`, `eslint`, `vitest`) проходить. Команди, які змінюють ці файли, не називаючи їх (наприклад `git pull`), хук не бачить, тут діє це правило.
