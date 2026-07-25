export function getWordBoundaries(value, cursor) {
    let start = cursor;
    let end = cursor;
    while (start > 0 && /\S/.test(value[start - 1])) start--;
    while (end < value.length && /\S/.test(value[end])) end++;
    return [start, end];
}

export function getTextPosition() {
    return { top: 0, left: 0, bottom: 0, right: 0 };
}
