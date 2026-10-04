// Optional image viewer. Links still open the original image without JavaScript.
const viewer = document.querySelector("#image-viewer");
if (viewer && typeof viewer.showModal === "function") {
  const image = viewer.querySelector("#viewer-image");
  const caption = viewer.querySelector("#viewer-caption");
  const original = viewer.querySelector("#viewer-original");
  for (const link of document.querySelectorAll("a[data-viewer]")) {
    link.addEventListener("click", (event) => {
      // Keep ordinary browser new-tab/window and download gestures intact.
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const figure = link.closest("figure");
      const source = figure.querySelector("img");
      image.src = link.href;
      image.alt = source.alt;
      caption.textContent = figure.querySelector("[data-caption]").dataset.caption;
      original.href = link.href;
      viewer.showModal();
      event.preventDefault();
    });
  }
}
