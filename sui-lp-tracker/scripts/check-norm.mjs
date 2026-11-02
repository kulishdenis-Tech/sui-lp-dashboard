import { normalizeStructTag } from '@mysten/sui/utils'
const t = '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
console.log('padded no 0x', normalizeStructTag(t))
console.log('0x2', normalizeStructTag('0x2::sui::SUI'))
console.log('0x0002', normalizeStructTag('0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'))
