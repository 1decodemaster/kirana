import { normalizeName } from './normalize.js';
export function fold(input) {
    let s = normalizeName(input);
    s = s.replace(/z/g, 'j');
    s = s
        .replace(/kh/g, 'k')
        .replace(/gh/g, 'g')
        .replace(/ch/g, 'c')
        .replace(/jh/g, 'j')
        .replace(/zh/g, 'j')
        .replace(/th/g, 't')
        .replace(/dh/g, 'd')
        .replace(/ph/g, 'f')
        .replace(/bh/g, 'b')
        .replace(/sh/g, 's');
    s = s
        .replace(/aa/g, 'a')
        .replace(/ee/g, 'i')
        .replace(/oo/g, 'u')
        .replace(/ii/g, 'i')
        .replace(/uu/g, 'u')
        .replace(/ou/g, 'u')
        .replace(/au/g, 'u');
    s = s.replace(/(.)\1+/g, '$1');
    s = s.replace(/h(?=\s|$)/g, '');
    return s.replace(/\s+/g, ' ').trim();
}
//# sourceMappingURL=fold.js.map