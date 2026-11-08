import { tr, currentLanguage } from './lang.js';

export function savingsTotals(stats = {}) {
    const number = value => Number.isFinite(value) ? value : 0;
    const textTokens = number(stats.textTokens) + number(stats.setup?.textTokens);
    const imageTokens = number(stats.imageTokens) + number(stats.setup?.imageTokens);
    return {
        textTokens: textTokens,
        imageTokens: imageTokens,
        saved: textTokens - imageTokens
    };
}

// Number formatting follows the effective UI language, not the browser locale,
// so an English tavern with a forced Russian extension stays consistent.
export const exactTokens = n => Math.round(n).toLocaleString(currentLanguage() === 'ru' ? 'ru-RU' : 'en-US');

export function savingsDetail(stats) {
    const {textTokens: textTokens, imageTokens: imageTokens, saved: saved} = savingsTotals(stats);
    return tr('Estimated input reduction: {saved} tokens ({text} as text → {image} as images). Excludes request overhead and cache discounts.')
        .replace('{saved}', exactTokens(saved))
        .replace('{text}', exactTokens(textTokens))
        .replace('{image}', exactTokens(imageTokens))
        + (stats?.experimental || stats?.setup?.experimental ? tr(' Experimental model: image tokens use your configured estimate, not measured billing.') : '');
}
