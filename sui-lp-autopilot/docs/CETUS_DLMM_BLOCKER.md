# Блокер Vault: локальний Cetus source не виконується

**Дата:** 2026-10-27  
**Рішення для `AUTO_GUARDED`:** лишається **заблокованим**. Локальний `abort 1` **не** доводить, що mainnet-байткод не можна викликати. Доказ композиції відсутній. Деталі: [VAULT_BYTECODE_FEASIBILITY.md](VAULT_BYTECODE_FEASIBILITY.md).

MANUAL_SIGN (читання пулів і непідписані PTB через DLMM SDK) від цього блокера не залежить і зібраний окремо. Симуляція SDK не є виконанням угоди і не є Move-тестом Vault.

## Що потрібно було

OWNER deposit → Vault → OPERATOR open Cetus DLMM LP → close → 100% активів у Vault → OWNER withdraw, з Move-тестами проти **реального** Cetus.

## Що є в офіційному джерелі

Репозиторій [CetusProtocol/cetus-dlmm-interface](https://github.com/CetusProtocol/cetus-dlmm-interface) сам себе описує як **interface packages** (`README.md`). Єдиний публічний Move-код для інтеграції:

| Модуль | Функція | Тіло в git |
|--------|---------|------------|
| `cetusdlmm::pool` | `open_position` | `abort 1` |
| `cetusdlmm::pool` | `repay_open_position` | `abort 1` |
| `cetusdlmm::pool` | `close_position` | `abort 1` |
| `cetusdlmm::pool` | `collect_position_fee` | `abort 1` |
| `dlmmrouter::add_liquidity` | `open_position` | `abort 1` |

Перевірено файл `packages/dlmm/sources/pool.move` (commit tree `main`, blob `f515ef91…`) і `packages/dlmm-router/sources/add_liquidity.move` (blob `c89c2d4f…`). У дереві репозиторія **немає** каталогу `tests/`, попри README «comprehensive tests».

Реальна логіка живе лише в **on-chain bytecode** (mainnet package з `Published.toml` / cetus-skills). Вихідники цієї логіки Cetus не публікує.

## Чому це блокує саме цей цикл

1. `sui move test` компілює залежності з **source**. Підключення `cetus-dlmm-interface` дає виклики, які завжди `abort 1`. Позитивний тест open/close **не може пройти** на реальному Cetus.
2. Написати свій пул «як Cetus» = stub. Це прямо заборонено критерієм «жодних mock/stub у критичному шляху».
3. Виклик mainnet bytecode з локального unit-test неможливий: немає вихідників, щоб їх зібрати в тестовий VM. Fork mainnet-об’єктів у `sui move test` Cetus не надає.
4. Інтеграційний прогін на testnet потребує опублікованого Cetus DLMM **з тією самою семантикою** і нашого пакета. Без виконуваних вихідників ми не можемо довести, що зібраний нами виклик збігається з mainnet-байткодом. Такого середовища в цій сесії немає → E2E **NOT TESTED**. Mainnet deploy і mainnet-кошти не використовувались.

## Що сигнатури *дозволяють* (коли з’явиться implementation)

Публічні сигнатури (не тіла) повертають значення, а не transfer на `ctx.sender()`:

- `open_position` → `(Position, OpenPositionCert)`
- `repay_open_position` споживає `Balance` і cert
- `close_position` / `collect_position_fee` → `Balance`

`Position has key, store` — Vault теоретично може зберігати NFT і не віддавати його оператору. Це **дизайн**, не доказ. Router-обгортка в документації Cetus часто робить `transfer` на sender; її не можна викликати з Operator key. Потрібні direct `pool::*` всередині нашого модуля — але їхні тіла в git відсутні, тож модуль не можна ні зібрати проти робочої логіки, ні протестувати.

## Що потрібно від Cetus, щоб зняти блокер

1. Опублікований **implementation** package (не `abort 1`) з тією самою адресою/версією, що mainnet, **або**
2. Офіційний testnet + інструкція integration-test, де `open/repay/close` виконуються і повертають `Balance`/`Position` у caller module.

До цього `AUTO_GUARDED` і «BUY/SELL LP через Vault» лишаються **не реалізованими**.
