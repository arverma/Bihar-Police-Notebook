export function getWordBoundaries(value, cursor) {
    let start = cursor;
    let end = cursor;
    while (start > 0 && /\S/.test(value[start - 1])) start--;
    while (end < value.length && /\S/.test(value[end])) end++;
    return [start, end];
}
