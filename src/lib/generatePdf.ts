import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { Issue } from "./types";

// A4 dimensions in mm
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

// Margins in mm
const MARGIN_TOP = 12;
const MARGIN_BOTTOM = 14;
const MARGIN_LEFT = 12;
const MARGIN_RIGHT = 12;

// Usable area in mm
const USABLE_WIDTH = A4_WIDTH_MM - MARGIN_LEFT - MARGIN_RIGHT;
const USABLE_HEIGHT = A4_HEIGHT_MM - MARGIN_TOP - MARGIN_BOTTOM;

// Render width in pixels (higher = better quality, must match container width)
const RENDER_WIDTH_PX = 794;

// html2canvas scale factor
const SCALE = 2;

// Conversion factor: DOM pixels → mm
const DOM_PX_TO_MM = USABLE_WIDTH / RENDER_WIDTH_PX;

interface RenderSurface {
  wrapper: HTMLDivElement;
  container: HTMLDivElement;
  cleanup: () => void;
}

interface TocLinkRect {
  issueId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Waits for the browser to fully layout and paint.
 */
function waitForPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

/**
 * Creates a full-screen white overlay so html2canvas can capture visible DOM.
 * Returns { wrapper, container, cleanup }.
 */
function createRenderSurface(): RenderSurface {
  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "position: fixed",
    "top: 0",
    "left: 0",
    "width: 100vw",
    "height: 100vh",
    "overflow: auto",
    "z-index: 99999",
    "background: #ffffff",
  ].join(";");

  const container = document.createElement("div");
  container.style.cssText = [
    `width: ${RENDER_WIDTH_PX}px`,
    "margin: 0 auto",
    "padding: 0",
    "background: #ffffff",
  ].join(";");

  wrapper.appendChild(container);
  document.body.appendChild(wrapper);

  return {
    wrapper,
    container,
    cleanup: () => document.body.removeChild(wrapper),
  };
}

/**
 * Prepares a single issue-page element for PDF rendering.
 */
function stylePage(pageEl: HTMLElement): void {
  pageEl.style.padding = "30px 40px";
  pageEl.style.background = "#ffffff";
  pageEl.style.boxShadow = "none";
  pageEl.style.border = "none";
  pageEl.style.borderRadius = "0";
  pageEl.style.margin = "0";
  pageEl.style.width = "100%";
  pageEl.style.boxSizing = "border-box";
  pageEl.style.overflow = "visible";
  pageEl.style.pageBreakBefore = "auto";
  pageEl.style.breakBefore = "auto";

  // Hide all pencil edit icons
  pageEl.querySelectorAll<HTMLElement>(".editable-pencil").forEach((el) => {
    el.style.display = "none";
  });

  // Hide elements marked as no-export (e.g. reindex button)
  pageEl.querySelectorAll<HTMLElement>(".no-export").forEach((el) => {
    el.style.display = "none";
  });

  // Hide translate buttons, restore buttons, and page action bar
  pageEl.querySelectorAll<HTMLElement>(".page-action-bar").forEach((el) => {
    el.style.display = "none";
  });
  pageEl.querySelectorAll<HTMLElement>(".translate-btn").forEach((el) => {
    el.style.display = "none";
  });
  pageEl.querySelectorAll<HTMLElement>(".restore-field-btn").forEach((el) => {
    el.style.display = "none";
  });

  // Hide add-row and remove-row buttons
  pageEl.querySelectorAll<HTMLElement>(".btn-add-row").forEach((el) => {
    el.style.display = "none";
  });
  pageEl.querySelectorAll<HTMLElement>(".btn-remove-row").forEach((el) => {
    el.style.display = "none";
  });

  // Remove modified-state visual indicators
  pageEl
    .querySelectorAll<HTMLElement>(".editable-display--modified")
    .forEach((el) => {
      el.style.borderLeft = "none";
      el.style.paddingLeft = "";
      el.style.marginLeft = "";
      el.classList.remove("editable-display--modified");
    });
  pageEl
    .querySelectorAll<HTMLElement>(".editable-block-display--modified")
    .forEach((el) => {
      el.style.borderLeft = "none";
      el.style.paddingLeft = "";
      el.style.marginLeft = "";
      el.classList.remove("editable-block-display--modified");
    });
  if (pageEl.classList.contains("issue-page--modified")) {
    pageEl.style.borderLeft = "none";
    pageEl.classList.remove("issue-page--modified");
  }

  // Remove hover-edit styling from editable wrappers
  pageEl
    .querySelectorAll<HTMLElement>(".editable-display, .editable-block-display")
    .forEach((el) => {
      el.style.cursor = "default";
      el.style.outline = "none";
      el.style.background = "transparent";
    });

  // Replace <select> severity dropdowns with plain badge spans
  pageEl
    .querySelectorAll<HTMLSelectElement>(".severity-select")
    .forEach((sel) => {
      const badge = document.createElement("span");
      badge.className = "severity-badge";
      badge.textContent =
        sel.value || sel.options[sel.selectedIndex]?.text || "";
      badge.style.backgroundColor = sel.style.backgroundColor;
      badge.style.color = sel.style.color;
      badge.style.display = "inline-block";
      badge.style.padding = "3px 14px";
      badge.style.borderRadius = "4px";
      badge.style.fontWeight = "600";
      badge.style.fontSize = "0.85rem";
      badge.style.textAlign = "center";
      badge.style.whiteSpace = "nowrap";
      sel.parentNode?.replaceChild(badge, sel);
    });

  // Hide any edit hints that might be visible
  pageEl.querySelectorAll<HTMLElement>(".editable-hint").forEach((el) => {
    el.style.display = "none";
  });
}

/**
 * Renders an element to a canvas using html2canvas.
 */
async function renderToCanvas(
  element: HTMLElement,
): Promise<HTMLCanvasElement> {
  return html2canvas(element, {
    scale: SCALE,
    useCORS: true,
    logging: false,
    scrollX: 0,
    scrollY: 0,
    windowWidth: RENDER_WIDTH_PX,
    backgroundColor: "#ffffff",
  });
}

/**
 * Given a canvas for a single issue page, adds it to the jsPDF document.
 * If the rendered content is taller than one A4 page, it splits it across
 * multiple pages by slicing the canvas into page-height strips.
 *
 * Returns the number of PDF pages consumed.
 */
function addCanvasToPdf(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  isFirstPage: boolean,
): number {
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;

  // How many mm wide the image will be drawn (fills usable width)
  const imgWidthMm = USABLE_WIDTH;
  // The pixel-to-mm ratio based on fitting to usable width
  const pxPerMm = canvasWidth / imgWidthMm;
  // Total height of the image in mm
  const totalImgHeightMm = canvasHeight / pxPerMm;

  if (totalImgHeightMm <= USABLE_HEIGHT) {
    // Fits on a single page — simple case
    if (!isFirstPage) {
      pdf.addPage();
    }
    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    pdf.addImage(
      imgData,
      "JPEG",
      MARGIN_LEFT,
      MARGIN_TOP,
      imgWidthMm,
      totalImgHeightMm,
    );
    return 1;
  } else {
    // Content is taller than one page — slice the canvas into strips
    const stripHeightPx = Math.floor(USABLE_HEIGHT * pxPerMm);
    let srcY = 0;
    let pageIndex = 0;

    while (srcY < canvasHeight) {
      const remainingPx = canvasHeight - srcY;
      const thisStripPx = Math.min(stripHeightPx, remainingPx);
      const thisStripMm = thisStripPx / pxPerMm;

      // Create a sub-canvas for this strip
      const stripCanvas = document.createElement("canvas");
      stripCanvas.width = canvasWidth;
      stripCanvas.height = thisStripPx;
      const ctx = stripCanvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvasWidth, thisStripPx);
      ctx.drawImage(
        canvas,
        0,
        srcY,
        canvasWidth,
        thisStripPx, // source rect
        0,
        0,
        canvasWidth,
        thisStripPx, // dest rect
      );

      if (!isFirstPage || pageIndex > 0) {
        pdf.addPage();
      }

      const stripData = stripCanvas.toDataURL("image/jpeg", 0.95);
      pdf.addImage(
        stripData,
        "JPEG",
        MARGIN_LEFT,
        MARGIN_TOP,
        imgWidthMm,
        thisStripMm,
      );

      srcY += thisStripPx;
      pageIndex++;
    }

    return pageIndex;
  }
}

/**
 * Measures the bounding rectangles of all TOC link items relative to the
 * container element. Returns an array of { issueId, x, y, w, h } where
 * x/y/w/h are in DOM pixels relative to the container's top-left.
 */
function measureTocLinks(
  cloneEl: HTMLElement,
  containerEl: HTMLElement,
): TocLinkRect[] {
  const tocItems = cloneEl.querySelectorAll<HTMLElement>(".toc-item");
  const containerRect = containerEl.getBoundingClientRect();
  const results: TocLinkRect[] = [];

  tocItems.forEach((item) => {
    const linkEl = item.querySelector<HTMLAnchorElement>(".toc-link");
    if (!linkEl) return;

    const href = linkEl.getAttribute("href") || "";
    const issueId = href.replace("#issue-", "");
    if (!issueId) return;

    const rect = item.getBoundingClientRect();
    results.push({
      issueId,
      x: rect.left - containerRect.left,
      y: rect.top - containerRect.top,
      w: rect.width,
      h: rect.height,
    });
  });

  return results;
}

/**
 * Adds internal GoTo link annotations on the TOC PDF page(s).
 *
 * @param pdf - The jsPDF instance
 * @param tocStartPage - 1-based PDF page where the TOC starts
 * @param tocPagesUsed - How many PDF pages the TOC spans
 * @param tocLinks - Array of { issueId, x, y, w, h } in DOM pixels
 * @param issueIdToPage - Map of issueId string → 1-based target PDF page
 */
function addTocLinkAnnotations(
  pdf: jsPDF,
  tocStartPage: number,
  tocPagesUsed: number,
  tocLinks: TocLinkRect[],
  issueIdToPage: Record<string, number>,
): void {
  for (const link of tocLinks) {
    const targetPage = issueIdToPage[link.issueId];
    if (!targetPage) continue;

    // Convert DOM pixel position to mm
    const linkXMm = MARGIN_LEFT + link.x * DOM_PX_TO_MM;
    const linkYMm = link.y * DOM_PX_TO_MM; // from top of full content
    const linkWMm = link.w * DOM_PX_TO_MM;
    const linkHMm = link.h * DOM_PX_TO_MM;

    // Determine which TOC PDF page this link falls on
    const tocPageOffset = Math.floor(linkYMm / USABLE_HEIGHT);
    if (tocPageOffset >= tocPagesUsed) continue; // safety

    const pdfPage = tocStartPage + tocPageOffset;
    const yOnPage = MARGIN_TOP + (linkYMm - tocPageOffset * USABLE_HEIGHT);

    // Switch to the TOC page and add the link annotation
    pdf.setPage(pdfPage);

    // jsPDF internal link using the annotation plugin
    // The link() method in jsPDF creates an annotation rectangle.
    // We use the internal API to create a GoTo action.
    pdf.link(linkXMm, yOnPage, linkWMm, linkHMm, {
      pageNumber: targetPage,
      // Jump to the top of the target page
      top: 0,
    });
  }
}

/**
 * Generates a PDF from the preview container element.
 * The first .issue-page is expected to be the TOC page (with class .toc-page).
 * Subsequent .issue-page elements are the individual issue pages.
 * After rendering, clickable link annotations are added to the TOC page
 * that jump to the corresponding issue pages.
 */
export async function generatePdf(
  _issues: Issue[],
  previewElement: HTMLElement,
): Promise<void> {
  if (!previewElement) {
    throw new Error("Preview element not found");
  }

  const pdf = new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: "portrait",
    compress: true,
  });

  // Create visible render surface
  const { container, cleanup } = createRenderSurface();

  try {
    const issuePages =
      previewElement.querySelectorAll<HTMLElement>(".issue-page");

    // Track PDF page starts for each DOM element (1-based page numbers)
    let currentPdfPage = 1;
    const elementPageStarts: number[] = []; // elementPageStarts[i] = first PDF page for issuePages[i]

    // TOC-specific data
    let tocStartPage = 1;
    let tocPagesUsed = 0;
    let tocLinks: TocLinkRect[] = []; // { issueId, x, y, w, h } in DOM px

    for (let i = 0; i < issuePages.length; i++) {
      const page = issuePages[i];
      const isToc = page.classList.contains("toc-page");
      const isFirstPage = i === 0;

      elementPageStarts[i] = currentPdfPage;

      // Clone and style the page
      const clone = page.cloneNode(true) as HTMLElement;

      // Sync <select> values from original to clone — cloneNode does NOT
      // preserve the runtime .value of form controls set by React.
      const origSelects = page.querySelectorAll<HTMLSelectElement>("select");
      const clonedSelects = clone.querySelectorAll<HTMLSelectElement>("select");
      origSelects.forEach((origSel, idx) => {
        if (clonedSelects[idx]) {
          clonedSelects[idx].value = origSel.value;
        }
      });

      stylePage(clone);

      // Clear container and add just this one page
      container.innerHTML = "";
      container.appendChild(clone);

      // Wait for layout + paint
      await waitForPaint();
      await new Promise<void>((r) => setTimeout(r, 100));

      // If this is the TOC page, measure link positions before rendering to canvas
      if (isToc) {
        tocStartPage = currentPdfPage;
        tocLinks = measureTocLinks(clone, container);
      }

      // Render to canvas
      const canvas = await renderToCanvas(container);

      // Add to PDF and track pages consumed
      const pagesUsed = addCanvasToPdf(pdf, canvas, isFirstPage);

      if (isToc) {
        tocPagesUsed = pagesUsed;
      }

      currentPdfPage += pagesUsed;
    }

    // Build a map: issueId → first PDF page number
    const issueIdToPage: Record<string, number> = {};
    for (let i = 0; i < issuePages.length; i++) {
      const dataIssueId = issuePages[i].getAttribute("data-issue-id");
      if (dataIssueId) {
        issueIdToPage[dataIssueId] = elementPageStarts[i];
      }
    }

    // Add clickable link annotations on the TOC page(s)
    if (tocLinks.length > 0 && tocPagesUsed > 0) {
      addTocLinkAnnotations(
        pdf,
        tocStartPage,
        tocPagesUsed,
        tocLinks,
        issueIdToPage,
      );
    }

    pdf.save("audit-report.pdf");
  } finally {
    cleanup();
  }
}
