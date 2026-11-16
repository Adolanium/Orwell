/*
  jsdom has neither `Blob.arrayBuffer` nor `Blob.text`; browsers do, and
  `ImportAccount` reads the account file through them, in slices (Task 11b: the
  container with the images can be hundreds of MB). Importing this file in a
  test restores them with jsdom's own `FileReader`.
*/
function lerComFileReader<T>(blob: Blob, como: "readAsArrayBuffer" | "readAsText"): Promise<T> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader()
    leitor.onload = () => resolver(leitor.result as T)
    leitor.onerror = () => rejeitar(leitor.error)
    leitor[como](blob)
  })
}

Blob.prototype.arrayBuffer ??= function (this: Blob) {
  return lerComFileReader<ArrayBuffer>(this, "readAsArrayBuffer")
}
Blob.prototype.text ??= function (this: Blob) {
  return lerComFileReader<string>(this, "readAsText")
}
