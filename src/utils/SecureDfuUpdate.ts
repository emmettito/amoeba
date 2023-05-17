import SecureDfu from "web-bluetooth-dfu"
import { SecureDfuPackage } from "./SecureDfuPackage"

const CRC32 = require("crc-32")

export interface SecureDfuUpdateProgress {
  object: string
  totalBytes: number
  currentBytes: number
}

export interface SecureDfuUpdateMessage {
  message: string
  final?: boolean
}

function getFirmware(): Promise<ArrayBuffer> {
  return require("./firmware/espruino_2v15.767_puckjs_minimal.zip")
}

export class SecureDfuUpdate {
  static EVENT_LOG = "log"
  static EVENT_PROGRESS = "progress"
  static EVENT_STATUS = "status"

  dfu: SecureDfu
  logCallback: (message: SecureDfuUpdateMessage) => Promise<any>
  progressCallback: (message: SecureDfuUpdateProgress) => Promise<any>
  statusCallback: (message: SecureDfuUpdateMessage) => Promise<any>

  constructor(statusCallback: (message: SecureDfuUpdateMessage) => Promise<any>, logCallback: (message: SecureDfuUpdateMessage) => Promise<any>, progressCallback: (message: SecureDfuUpdateProgress) => Promise<any>) {
    this.logCallback = logCallback
    this.statusCallback = statusCallback
    this.progressCallback = progressCallback
    this.dfu = new SecureDfu(CRC32.buf)
    this.dfu.addEventListener(SecureDfu.EVENT_LOG, logCallback)
    this.dfu.addEventListener(SecureDfu.EVENT_PROGRESS, progressCallback)
  }

  private async loadPackage(): Promise<SecureDfuPackage> {
    return new SecureDfuPackage(await getFirmware())
  }

  async update() {
    const updatePackage = this.loadPackage()

    await this.statusCallback({ message: "Connecting to device" })
    const device = await this.dfu.requestDevice(false, null)

    await this.statusCallback({ message: `Loading firmware`})
    const baseImage = await (await updatePackage).getBaseImage()
    const appImage = await (await updatePackage).getAppImage()

    for (const image of [baseImage, appImage]) {
      if (image) {
        await this.statusCallback({ message: `Updating ${image.type}: ${image.imageFile}...` })
        await this.dfu.update(device, image.initData, image.imageData);
      }
    }

    await this.statusCallback({ message: "Update complete!", final: true })
  }
}
