/** What a reader remembers of each log file it has read, made when the file is first seen */
export class FileStates<S> {
  private files = new Map<string, S>()

  constructor(private fresh: () => S) {}

  get(file: string): S {
    let s = this.files.get(file)
    if (!s) {
      s = this.fresh()
      this.files.set(file, s)
    }
    return s
  }

  reset(file: string) {
    this.files.delete(file)
  }
}
