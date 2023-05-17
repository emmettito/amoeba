require("./style/main.scss")

import { getBlankNtag } from "./utils/ntag215"
import { Puck } from "./utils/puck"
import { showModal, hideModal, setModal, ModalButtonTypes, ModalResult } from "./utils/modal"
import { saveData, readFile } from "./utils/fileHelpers"
import { supportsBluetooth, bluetoothOrError } from "./utils/browserCheck"
import { SecureDfuUpdate, SecureDfuUpdateMessage, SecureDfuUpdateProgress } from "./utils/SecureDfuUpdate"
import * as EspruinoHelper from "./utils/espruino"
import { ModalMessageType, modalMessages } from "./utils/modalMessages"

const slotTemplate = require("./templates/slot.pug")

const anyWindow = (window as any)
const puck = anyWindow.puck = new Puck(console.log, console.warn, console.error)

// TODO retrieve from export
const firmwareName = "dtm-1.0.1";

$(() => {
  const mainContainer = $("#mainContainer")
  const slotsContainer = $("#slotsContainer")

  if (supportsBluetooth !== true) {
    showModal({
      title: "Unsupported Browser",
      message: supportsBluetooth,
      htmlEscapeBody: false
    })
  }

  async function populateSlots() {
    slotsContainer.empty()

    if (puck.isConnected) {
      const info = await puck.getSlotInformation()

      for (let i = 0; i < info.totalSlots; i++) {
        setModal({
          message: `Reading Slot ${i + 1}`
        })
        const slotInfo = await puck.readSlotSummary(i)
        slotsContainer.append(getSlotElement(i, slotInfo))
      }
    }
  }

  function array2hex(data: Uint8Array): string {
    return Array.prototype.map.call(data, (e: number) => ("00" + e.toString(16)).slice(-2)).join("")
  }

  async function updateSlotElement(slot: number, oldElement: JQuery<HTMLElement>) {
    const info = await puck.readSlotSummary(slot)
    getSlotElement(slot, info).insertAfter(oldElement)
    oldElement.remove()
  }

  async function writeSlot(slot: number, data: Uint8Array, element: JQuery<HTMLElement>) {
    await showModal({
      title: "Please Wait",
      message: `Writing slot ${slot + 1}`,
      preventClose: true
    })
    await puck.writeSlot(slot, data)
    await updateSlotElement(slot, element)
    await hideModal()
  }

  function getSlotElement(slot: number, summary: Uint8Array): JQuery<HTMLElement> {
    const element = $(slotTemplate({
      slot,
      uid: array2hex(summary.slice(0, 8))
    }))

    element.find("a.slot-download-link").on("click", async (e) => {
      e.preventDefault()

      try {
        await showModal({
          title: "Please Wait",
          message: `Reading slot ${slot + 1}`,
          preventClose: true
        })
        const data = await puck.readSlot(slot)
        await hideModal()
        saveData(data, `slot${slot}.bin`)
      } catch (error) {
        await showModal({
          title: "Error",
          message: error.toString()
        })
      }
    })

    element.find("a.slot-upload-link").on("click", async (e) => {
      e.preventDefault()

      try {
        const file = await readFile(572)
        await writeSlot(slot, file.data, element)
      } catch (error) {
        await showModal({
          title: "Error",
          message: error.toString()
        })
      }
    })

    element.find("a.slot-clear-link").on("click", async (e) => {
      e.preventDefault()

      await writeSlot(slot, getBlankNtag(), element)
    })

    element.find("a.slot-select-link").on("click", async (e) => {
      e.preventDefault()

      try {
        await showModal({
          title: "Please Wait",
          message: `Changing to slot ${slot + 1}`,
          preventClose: true
        })
        await puck.changeSlot(slot)
        await hideModal()
      } catch (error) {
        await showModal({
          title: "Error",
          message: error.toString()
        })
      }
    })

    return element
  }

  async function connectPuck(e: Event | JQuery.Event) {
    e.preventDefault()

    try {
      await bluetoothOrError()
      await showModal({
        title: "Please Wait",
        message: "Connecting to puck",
        preventClose: true
      })
      await puck.connect(async (ev) => {
        await disconnectPuck(ev)
      })

      if (puck.isConnected) {
        await populateSlots()

        mainContainer.addClass("connected")
      }

      if (firmwareName !== puck.firmwareName) {
        const installUpdatedScript = ModalResult.ButtonYes === await showModal({
          title: "Script Update Available",
          message: "There is a script update available, do you want to update?",
          dialog: true,
          buttons: ModalButtonTypes.YesNo
        })

        if (installUpdatedScript) {
          await enableUart(e)
          await uploadScript(e)
        }
      } else {
        await hideModal()
      }

    } catch (error) {
      await showModal({
        title: "Error",
        message: error.toString()
      })
    }
  }

  async function disconnectPuck(e: Event | JQuery.Event) {
    e.preventDefault()
    try {
      if (puck.isConnected) {
        await showModal({
          title: "Please Wait",
          message: "Disconnecting from puck",
          preventClose: true
        })
        await puck.disconnect()
      }

      mainContainer.removeClass("connected")

      await hideModal()
    } catch (error) {
      await showModal({
        title: "Error",
        message: error.toString()
      })
    }
  }

  async function enableUart(e: Event | JQuery.Event) {
    e.preventDefault()
    try {
      await showModal({
        title: "Please Wait",
        message: "Enabling UART",
        preventClose: true
      })
      await puck.enableUart()
      await disconnectPuck(e)
      await hideModal()
    } catch (error) {
      await showModal({
        title: "Error",
        message: error.toString()
      })
    }
  }

  async function changeName(e: Event | JQuery.Event) {
    e.preventDefault()
    try {
      await showModal({
        title: "Please Wait",
        message: "Reading puck name",
        preventClose: true
      })
      const currentName = await puck.getName()
      const newName = prompt("Enter a name", currentName)

      if (newName != null) {
        await showModal({
          title: "Please Wait",
          message: "Setting puck name",
          preventClose: true
        })
        await puck.setName(newName)
      }

      await hideModal()
    } catch (error) {
      await showModal({
        title: "Error",
        message: error.toString()
      })
    }
  }

  async function uploadScript(e: Event | JQuery.Event) {
    try {
      await bluetoothOrError()
      await showModal({
        title: "Please Wait",
        message: "Connecting to puck",
        preventClose: true
      })
      await EspruinoHelper.open()

      const board = await EspruinoHelper.getBoard()
      const ver = await EspruinoHelper.getNtagVersion()

      if (!(ver.major === 1 && ver.minor >= 0)) {
        EspruinoHelper.close()

        if (ModalResult.ButtonYes === await showModal({
          title: "Firmware Update",
          message: "To use this script you must install a custom firmware onto your Puck.js, do you want to do that now?",
          preventClose: true,
          buttons: ModalButtonTypes.YesNo,
          dialog: true
        })) {
          await showModal({
            title: "Loading Firmware",
            message: "Downloading firmware",
            preventClose: true
          })
          await updateFirmware(e, true)
        } else {
          return
        }
      }

      const modalResult = await showModal({
        title: "Save to Flash?",
        message: modalMessages(ModalMessageType.SaveToFlash),
        htmlEscapeBody: false,
        buttons: ModalButtonTypes.YesNo,
        dialog: true,
        preventClose: true
      })

      await showModal({
        title: "Please Wait",
        message: "Uploading script file, please wait.",
        preventClose: true
      })

      await EspruinoHelper.writeCode({
        saveToFlash: modalResult === ModalResult.ButtonYes,
        board
      })

      EspruinoHelper.close()
      await hideModal()
    } catch (error) {
      EspruinoHelper.close()

      await showModal({
        title: "Error",
        message: error.toString()
      })
    }
  }

  async function updateFirmware(e: Event | JQuery.Event, throwError?: boolean) {
    let modalShown = false
    let canClose = true

    try {
      await bluetoothOrError()

      await showModal({
        title: "Instructions",
        message: modalMessages(ModalMessageType.DfuInstructions),
        dialog: true,
        preventClose: true,
        buttons: ModalButtonTypes.Next
      })

      let previousMessage: string

      async function status(event: SecureDfuUpdateMessage) {
        previousMessage = event.message
        canClose = event.final

        if (modalShown === false || event.final) {
          modalShown = true
          await showModal({
            title: "Updating Firmware",
            message: previousMessage,
            preventClose: event.final !== true
          })
        } else {
          setModal({
            title: "Updating Firmware",
            message: previousMessage
          })
        }
      }

      async function log(event: SecureDfuUpdateMessage) {
        console.log(event)
      }

      async function progress(event: SecureDfuUpdateProgress) {
        setModal({
          title: "Updating Firmware",
          message: modalMessages(ModalMessageType.FirmwareUpdate, {
            message: previousMessage,
            currentBytes: event.currentBytes,
            totalBytes: event.totalBytes
          })
        })
      }

      const dfu = new SecureDfuUpdate(status, log, progress)

      await dfu.update()
    } catch (error) {
      if (throwError) {
        throw error
      }

      if (modalShown === false || canClose !== true) {
        await showModal({
          title: "Error",
          message: error.toString()
        })
      } else {
        setModal({
          title: "Error",
          message: error.toString()
        })
      }
    }
  }

  $("#puckConnect").on("click", connectPuck).prop("disabled", false)
  $("#puckDisconnect").on("click", disconnectPuck).prop("disabled", false)
  $("#puckUart").on("click", enableUart).prop("disabled", false)
  $("#puckName").on("click", changeName).prop("disabled", false)
  $("#uploadScript").on("click", uploadScript).prop("disabled", false)
  $("#updateFirmware").on("click", updateFirmware).prop("disabled", false)
})
