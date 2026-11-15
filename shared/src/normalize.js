export function normalizeName(input) {
    return input
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[\u2018\u2019\u02BC`]/g, "'")
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
//# sourceMappingURL=normalize.js.map