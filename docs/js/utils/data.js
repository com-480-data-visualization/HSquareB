// Processed JSON sits under docs/ so GitHub Pages serves site + data from one root.

const BASE_PATH = "data/processed/";

export async function loadJSON(filename) {
    const url = BASE_PATH + filename;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`failed to load ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json();
}
