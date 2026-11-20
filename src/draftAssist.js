import { characterVariants } from "./data.js";

const MATCH_INTERVAL = 1200;
const REQUIRED_FRAMES = 3;

export function detectedTeammates(matches) {
  const picks = [1, 2].map((slot) => {
    const match = matches.find((item) => item.slotIndex === slot && !item.isSelf);
    if (!match?.character || !(match.confidence >= 0.88 && match.margin >= 0.04)) return null;
    const variants = characterVariants.filter((variant) => variant.characterId === match.character.id);
    if (variants.length === 1) return variants[0];
    if (!(match.weaponConfidence >= 0.9 && match.weaponMargin >= 0.04)) return null;
    return variants.find((variant) => variant.weapon === match.weapon);
  });
  return picks.every(Boolean) && picks[0].characterId !== picks[1].characterId
    ? picks.map(({ variantId }) => variantId) : null;
}

export function mountDraftAssist({ t, isElectron, getManualTeam, recommendTeam, confirmTeam, recommendationVersion }) {
  const panel = document.querySelector("#draft-assist");
  const status = document.querySelector("#draft-status");
  const overlayButton = document.querySelector("#draft-overlay");
  const captureButton = document.querySelector("#draft-capture");
  const stopButton = document.querySelector("#draft-stop");
  const applyButton = document.querySelector("#draft-apply");
  const preview = document.querySelector("#draft-preview");
  const pip = window.documentPictureInPicture;
  const canCapture = !isElectron && Boolean(navigator.mediaDevices?.getDisplayMedia);
  if (!pip && !canCapture) return;

  panel.hidden = false;
  overlayButton.hidden = !pip;
  captureButton.hidden = !canCapture;

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const canvas = document.createElement("canvas");
  const nameOf = (id) => {
    const character = characterVariants.find((item) => item.variantId === id);
    return character ? t(`char.${character.characterId}`) + " · " + t(`weapon.${character.weapon}`) : id;
  };
  let stream;
  let overlay;
  let timer;
  let detected;
  let lastMatch = "";
  let lastFrame = -1;
  let reading = false;
  let matchesInARow = 0;
  let renderedKey;
  let statusKey = "draftAssist.hint";

  function buildList(list, names) {
    const doc = list.ownerDocument;
    list.replaceChildren(...names.map((name) => {
      const row = doc.createElement("li");
      row.textContent = name;
      return row;
    }));
  }

  function render() {
    const picks = detected ?? getManualTeam();
    const label = t(detected ? "draftAssist.detected" : picks.length ? "draftAssist.manual" : statusKey,
      { picks: picks.map(nameOf).join(" / ") });
    const captureStatus = t(statusKey);
    status.textContent = detected ? label : captureStatus;
    // applyTranslations must not restore the initial text over a live status.
    status.removeAttribute("data-i18n");
    preview.hidden = !detected;
    applyButton.hidden = !detected;
    stopButton.hidden = !stream;
    if (!overlay && !detected) return;

    const key = JSON.stringify([picks, label, Boolean(detected), Boolean(overlay), recommendationVersion()]);
    if (key === renderedKey) return;
    renderedKey = key;
    const unique = new Set();
    const names = [];
    if (picks.length) {
      for (const { character } of recommendTeam(picks)) {
        if (unique.has(character.variantId)) continue;
        unique.add(character.variantId);
        names.push(nameOf(character.variantId));
        if (names.length === 3) break;
      }
    }
    if (detected) buildList(preview, names);
    if (overlay) {
      overlay.document.documentElement.lang = document.documentElement.lang;
      overlay.document.querySelector("h1").textContent = t("draftAssist.overlayTitle");
      overlay.document.querySelector("p").textContent = names.length
        ? label : label + " " + t("draftAssist.noPicks");
      buildList(overlay.document.querySelector("ol"), names);
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!reading && (overlay || stream)) timer = setTimeout(tick, MATCH_INTERVAL);
  }

  function stop(message = "draftAssist.hint") {
    const oldStream = stream;
    stream = undefined;
    oldStream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    detected = null;
    lastMatch = "";
    lastFrame = -1;
    matchesInARow = 0;
    statusKey = message;
    captureButton.disabled = false;
    render();
    schedule();
  }

  async function tick() {
    const current = stream;
    if (current && video.readyState >= 2 && video.videoWidth && video.videoHeight && lastFrame !== video.currentTime) {
      reading = true;
      lastFrame = video.currentTime;
      try {
        const { detectTeamFromScreenshot } = await import("./detector.js");
        if (current !== stream) return;
        const picks = detectedTeammates(await detectTeamFromScreenshot(video, canvas));
        if (current !== stream) return;
        const key = picks?.join("/") ?? "";
        matchesInARow = key && key === lastMatch ? matchesInARow + 1 : 1;
        lastMatch = key;
        if (!detected || detected.join("/") !== key) detected = matchesInARow >= REQUIRED_FRAMES ? picks : null;
      } catch {
        if (current === stream) stop("draftAssist.captureError");
        return;
      } finally {
        reading = false;
        schedule();
      }
    }
    render();
    schedule();
  }

  captureButton.addEventListener("click", async () => {
    captureButton.disabled = true;
    let requestedStream;
    try {
      requestedStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "window", frameRate: { ideal: 3, max: 5 } },
        audio: false, monitorTypeSurfaces: "exclude", selfBrowserSurface: "exclude",
      });
      const track = requestedStream.getVideoTracks()[0];
      if (track?.getSettings().displaySurface !== "window") {
        requestedStream.getTracks().forEach((entry) => entry.stop());
        stop("draftAssist.windowOnly");
        return;
      }
      stream = requestedStream;
      track.addEventListener("ended", () => {
        if (stream === requestedStream) stop();
      }, { once: true });
      video.srcObject = stream;
      await video.play();
      if (stream !== requestedStream) return;
      statusKey = "draftAssist.scanning";
      render();
      schedule();
    } catch (error) {
      if (!requestedStream || requestedStream === stream) stop(
        error.name === "NotAllowedError" ? "draftAssist.hint" : "draftAssist.captureError",
      );
    }
  });

  overlayButton.addEventListener("click", async () => {
    if (overlay) {
      overlay.focus();
      return;
    }
    overlayButton.disabled = true;
    try {
      const opened = await pip.requestWindow({ width: 360, height: 240 });
      overlay = opened;
      const doc = opened.document;
      doc.title = t("draftAssist.overlayTitle");
      const style = doc.createElement("style");
      style.textContent = `
        :root { color-scheme: dark; font: 15px system-ui; background: #101116; color: #f0f1f6; }
        body { margin: 0; padding: 14px 18px; } h1 { margin: 0 0 8px; font-size: 16px; }
        p { margin: 0; color: #acb2c4; font-size: 13px; overflow-wrap: anywhere; }
        ol { margin: 10px 0 0; padding-left: 24px; } li { padding: 4px; } li::marker { color: #a7f3d0; }
      `;
      doc.head.append(style);
      doc.body.append(doc.createElement("h1"), doc.createElement("p"), doc.createElement("ol"));
      opened.addEventListener("pagehide", () => {
        if (overlay === opened) overlay = undefined;
        renderedKey = undefined;
        schedule();
      }, { once: true });
      render();
      schedule();
    } catch {
      statusKey = "draftAssist.overlayError";
      render();
    } finally {
      overlayButton.disabled = false;
    }
  });
  stopButton.addEventListener("click", () => stop());
  applyButton.addEventListener("click", () => {
    if (detected) confirmTeam(detected);
  });
  window.addEventListener("pagehide", () => {
    stop();
    overlay?.close();
    clearTimeout(timer);
  });
}
