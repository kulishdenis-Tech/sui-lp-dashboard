# Vault ↔ Cetus DLMM bytecode: що перевірено і чому AUTO_GUARDED лишається заблокованим

**Дата:** 2026-10-27  
**Висновок:** композицію Move Vault з опублікованим Cetus DLMM **не можна вважати доведеною**. `AUTO_GUARDED` лишається **заблокованим**. Локальний `abort 1` у interface-пакеті **не** є доказом, що mainnet-контракт не виконується.

## Що таке `abort 1`

Репозиторій [CetusProtocol/cetus-dlmm-interface](https://github.com/CetusProtocol/cetus-dlmm-interface) сам називає вміст **interface packages** (README). Тіла публічних функцій у git — `abort 1`. Це заглушка для компілятора і для `sui move test`, який виконує **локальний source**.

`Published.toml` пакета `cetusdlmm` (main, прочитано 2026-10-27) зв’язує цей source з уже опублікованим пакетом:

| Поле | Mainnet |
|------|---------|
| chain-id | `35834a8a` |
| original-id | `0x5664f9d3fd82c84023870cfbda8ea84e14c8dd56ce557ad2116e0668581a682b` |
| published-at | `0x6b989f9b05bd11a00f1c7779443d66802c5e71631f59e87be5d2a616991f151e` |
| version | 10 |

На published-at `0x6b989f9b05bd11a00f1c7779443d66802c5e71631f59e87be5d2a616991f151e` RPC `getObject` (2026-10-27) повернув об’єкт типу `package`, version `10`, owner Immutable. Адреса з `Published.toml` існує. Виклик із залежного пакета на мережі має йти в цей bytecode, а не в локальне тіло `abort 1`. Провал `sui move test` на interface це не спростовує і не підтверджує: сигнатури з байткодом не звірялись.

## Що в інтерфейсі сумісне з ідеєю Vault

Перевірено source `packages/dlmm/sources/pool.move` і `position.move` (гілка `main`, 2026-10-27):

| Символ | Видимість / abilities | Наслідок для Vault |
|--------|------------------------|--------------------|
| `Position` | `public struct Position has key, store` | Теоретично можна зберігати у полі Vault, якщо on-chain тип той самий |
| `open_position` | `public fun` → `(Position, OpenPositionCert)` | Не робить `transfer` на sender |
| `OpenPositionCert` | немає abilities (hot potato) | Треба спожити в тій самій функції через `repay_open_position` |
| `repay_open_position` | `public fun`, споживає `Balance` + cert | Капітал лишається в caller, якщо caller — Vault |
| `remove_liquidity` | `public fun` → `(Balance, Balance)` | Повернення в Vault, не оператору |
| `collect_position_fee` | `public fun` → `(Balance, Balance)` | Те саме |
| `close_position` | `public fun` → `(ClosePositionCert, Balance, Balance)` | Потрібен розбір cert нагород, не лише двох балансів |

`Move.toml` інтерфейсу: edition `2024`, залежності MVR `@cetuspackages/inter-mate` і `@cetuspackages/move-stl`. Наш `move/vault/Move.toml` — edition `2024.beta`, Cetus **не** підключений. Збірка Vault+Cetus у цій сесії не запускалась: `sui` CLI відсутній (`The term 'sui' is not recognized`).

## Чого ця перевірка не доводить

1. **Байткод `published-at` не звірявся з цими сигнатурами.** Немає `sui move build` проти `Published.toml` і немає diff дизасембльованого пакета. Upgrade version 10 міг розійтись із git `main`.
2. **Abilities on-chain не прочитані з bytecode.** `store` у git не гарантує, що опублікований `Position` досі `store`. Без цього Vault не зможе покласти NFT у структуру.
3. **Локальний VM не виконує mainnet bytecode.** Позитивний `sui move test` на interface завжди впирається в `abort 1`. Це обмеження тестового раннера, не вирок mainnet.
4. **Немає негативних Move-тестів** на withdraw / transfer Position / підміну пулу / обхід hard-limit по кожному bin.
5. **JS SDK dry-run не є доказом композиції Vault.** `sendSimulationTransaction` перевіряє PTB від адреси OWNER. Він не виконує наш Move-модуль і не тримає капітал у Vault.

Поки пункти 1–4 не закриті окремим прогоном із Sui CLI і звіркою published package, автоматичний OPERATOR не підключається.

## Що вже можна без Vault

MANUAL_SIGN у цьому дереві читає пули через `@cetusprotocol/dlmm-sdk` і віддає **непідписані** BCS-байти. Підпис лишається в гаманці OWNER. Це не `AUTO_GUARDED` і не виконання угоди.
