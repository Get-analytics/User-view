import React, {
  useEffect,
  useState,
  useRef,
  useCallback
} from "react";
import { Worker, Viewer } from "@react-pdf-viewer/core";
import "@react-pdf-viewer/core/lib/styles/index.css";
import { useUser } from "../../context/Usercontext";

/* =============================================================================
   HELPER FUNCTIONS
============================================================================= */

// Simple throttle helper to limit execution frequency (for mobile events)
const throttle = (func, delay) => {
  let lastCall = 0;
  return (...args) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }
  };
};

// Simple debounce helper to execute a function after a delay only if no new call occurs
const debounce = (func, delay) => {
  let timerId;
  return (...args) => {
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(() => {
      func(...args);
      timerId = null;
    }, delay);
  };
};

// Check for mobile device using user agent and touch support
const checkIsMobile = () => {
  return /Mobi|Android/i.test(navigator.userAgent) || ("ontouchstart" in window);
};

// Helper to check if entire selection is within a given container
const isSelectionWithinContainer = (container) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return container.contains(range.startContainer) && container.contains(range.endContainer);
};

/* =============================================================================
   MAIN COMPONENT
============================================================================= */

const MyPdfViewer = ({ url, mimeType }) => {
  // Get user context values
  const { ip, location, userId, region, os, device, browser } = useUser();

  // Determine device type and store it in state (mobile vs. desktop)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(checkIsMobile());
  }, []);

  // Ref for the PDF viewer container; event listeners will attach here
  const viewerContainerRef = useRef(null);

  // State for pdfjs and its worker
  const [pdfjs, setPdfjs] = useState(null);
  const [pdfjsWorker, setPdfjsWorker] = useState(null);
  
  // State to track the current page number
  const [currentPage, setCurrentPage] = useState(1);

  /* -------------------------------------------------------------------------
     REFS FOR ANALYTICS & PAGE TRACKING
  ------------------------------------------------------------------------- */
  // Track time spent on each page (object where keys are page numbers)
  const timeSpentRef = useRef({});
  // Store the timer for the current page
  const pageTimerRef = useRef(null);
  // Track visited pages (using a Set to avoid duplicates)
  const visitedPagesRef = useRef(new Set());
  // Track milestone visits (every 10 pages visited)
  const milestoneVisitedPagesRef = useRef(0);

  /* -------------------------------------------------------------------------
     ANALYTICS STATES
  ------------------------------------------------------------------------- */
  const [totalClicks, setTotalClicks] = useState(0);
  const [selectedTexts, setSelectedTexts] = useState([]);
  const [linkClicks, setLinkClicks] = useState([]);
  const [pageVisitCount, setPageVisitCount] = useState({});

  // The file URL for the PDF viewer
  const fileUrl = url;

  // Initialize analytics data; this object collects contextual info and events.
  const [analyticsData, setAnalyticsData] = useState({
    ip: ip || "",
    location: location || "",
    userId: userId || "",
    region: region || "",
    os: os || "",
    device: device || "",
    browser: browser || "",
    pdfId: window.location.pathname.split("/").pop() || "",
    sourceUrl: url,
    totalPagesVisited: 0,
    totalTimeSpent: 0,
    pageTimeSpent: {},
    selectedTexts: [],
    totalClicks: 0,
    inTime: new Date().toISOString(), // Set once on initial load
    outTime: null,
    mostVisitedPage: null,
    linkClicks: [],
    totalPages: 0,
  });

  // Ref to always have the latest analyticsData (for use in timer callbacks)
  const analyticsDataRef = useRef(analyticsData);
  useEffect(() => {
    analyticsDataRef.current = analyticsData;
  }, [analyticsData, selectedTexts, totalClicks, linkClicks]);

  /* -------------------------------------------------------------------------
     IDENTITY API CALL MANAGEMENT
     
     We want to call the identity API only once when the user data is ready.
     A debounced function is used to delay the call for 3 seconds.
  ------------------------------------------------------------------------- */
  // Ref to ensure identity API is fired only once
  const identityCalledRef = useRef(false);

  // Debounced identity API call function (3-second delay)
  const debouncedSendIdentityRequest = useCallback(
    debounce(async () => {
      // Guard: Do not call if already called or if data is missing
      if (!userId || !window.location.pathname || identityCalledRef.current) return;
      identityCalledRef.current = true; // Mark as called

      const documentId = window.location.pathname.split("/").pop();
      const requestData = { userId, documentId, mimeType: "pdf" };

      try {
        const response = await fetch("https://user-view-backend.vercel.app/api/user/identify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestData),
        });
        if (!response.ok) {
          throw new Error("Failed to identify user");
        }
        const result = await response.json();
        console.log("User identification successful:", result);
      } catch (error) {
        console.error("Error sending identification request:", error);
      }
    }, 3000),
    [userId, mimeType]
  );

  // Trigger identity API call when userId is stable
  useEffect(() => {
    if (userId && userId.length > 15 && !identityCalledRef.current) {
      debouncedSendIdentityRequest();
    }
  }, [userId, debouncedSendIdentityRequest]);

  /* -------------------------------------------------------------------------
     UPDATE ANALYTICS CONTEXT VALUES WHEN CONTEXT CHANGES
  ------------------------------------------------------------------------- */
  useEffect(() => {
    setAnalyticsData((prevData) => ({
      ...prevData,
      ip: ip || "",
      location: location || "",
      userId: userId || "",
      region: region || "",
      os: os || "",
      device: device || "",
      browser: browser || "",
    }));
  }, [ip, location, userId, region, os, device, browser]);

  /* -------------------------------------------------------------------------
     LOAD PDF.JS MODULE & WORKER DYNAMICALLY
  ------------------------------------------------------------------------- */
  useEffect(() => {
    const loadPdfjs = async () => {
      try {
        const pdfjsModule = await import("pdfjs-dist/build/pdf");
        const pdfjsWorkerModule = await import("pdfjs-dist/build/pdf.worker.entry");
        // Set the worker source for pdfjs
        pdfjsModule.GlobalWorkerOptions.workerSrc = pdfjsWorkerModule;
        setPdfjs(pdfjsModule);
        setPdfjsWorker(pdfjsWorkerModule);
      } catch (error) {
        console.error("Error loading pdfjs modules:", error);
      }
    };
    loadPdfjs();
  }, []);

  /* -------------------------------------------------------------------------
     HANDLE PAGE CHANGE EVENT
     
     - When the page changes, clear the existing timer and start a new one.
     - Update time spent on the new page.
     - Track visited pages and calculate the most visited page.
  ------------------------------------------------------------------------- */
  const handlePageChange = useCallback(
    (e) => {
      const newPage = e.currentPage + 1; // Pages are 0-indexed in the event
      clearInterval(pageTimerRef.current);

      // Ensure we have a timer for this page
      if (!timeSpentRef.current[newPage]) {
        timeSpentRef.current[newPage] = 0;
      }

      // Start timer to count time on this page every second
      pageTimerRef.current = setInterval(() => {
        timeSpentRef.current[newPage] += 1;
        setAnalyticsData((prevData) => ({
          ...prevData,
          totalTimeSpent: prevData.totalTimeSpent + 1,
          pageTimeSpent: {
            ...prevData.pageTimeSpent,
            [newPage]: (prevData.pageTimeSpent[newPage] || 0) + 1,
          },
        }));
      }, 1000);

      // Update visited pages set
      visitedPagesRef.current.add(newPage);
      const visitedPagesCount = visitedPagesRef.current.size;
      if (visitedPagesCount >= milestoneVisitedPagesRef.current + 10) {
        milestoneVisitedPagesRef.current = Math.floor(visitedPagesCount / 10) * 10;
        console.log(`Visited Pages Milestone: ${milestoneVisitedPagesRef.current} pages visited.`);
      }
      setAnalyticsData((prevData) => ({
        ...prevData,
        totalPagesVisited: visitedPagesCount,
      }));

      // Update page visit counts and determine the most visited page
      setPageVisitCount((prevCount) => {
        const newCount = { ...prevCount, [newPage]: (prevCount[newPage] || 0) + 1 };
        let mostVisitedPage = null;
        let maxTimeSpent = 0;
        for (const [page, time] of Object.entries(timeSpentRef.current)) {
          if (time > maxTimeSpent) {
            mostVisitedPage = page;
            maxTimeSpent = time;
          }
        }
        setAnalyticsData((prevData) => ({
          ...prevData,
          mostVisitedPage: mostVisitedPage,
        }));
        return newCount;
      });

      setCurrentPage(newPage);
    },
    [setAnalyticsData]
  );

  /* -------------------------------------------------------------------------
     HANDLE TEXT SELECTION
     
     - Capture text selection only within the PDF viewer container.
     - Verify that both the start and end of the selection lie within the container.
     - Truncate if the text is too long and update analytics.
  ------------------------------------------------------------------------- */
  const handleTextSelection = useCallback(() => {
    const container = viewerContainerRef.current;
    if (!container || !isSelectionWithinContainer(container)) return;

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (selectedText) {
      // Limit selected text to 300 characters
      const truncatedText = selectedText.length > 300 ? selectedText.slice(0, 300) : selectedText;
      console.log(`Selected Text on page ${currentPage}: "${truncatedText}"`);

      setSelectedTexts((prevTexts) => {
        const existingText = prevTexts.find(
          (item) => item.selectedText === truncatedText && item.page === currentPage
        );
        if (existingText) {
          return prevTexts.map((item) =>
            item.selectedText === truncatedText && item.page === currentPage
              ? { ...item, count: item.count + 1 }
              : item
          );
        } else {
          return [...prevTexts, { selectedText: truncatedText, count: 1, page: currentPage }];
        }
      });
    }
  }, [currentPage]);

  /* -------------------------------------------------------------------------
     HANDLE LINK CLICKS
     
     - Intercept clicks on links inside the PDF.
     - Prevent default behavior and open the link in a new tab.
     - Log the event in analytics.
  ------------------------------------------------------------------------- */
  const handleLinkClick = useCallback(
    (e) => {
      const linkElement = e.target.closest("a");
      if (linkElement) {
        e.preventDefault();
        const linkUrl = linkElement.href;
        console.log(`Link clicked on page ${currentPage}: ${linkUrl}`);
        window.open(linkUrl, "_blank");
        setLinkClicks((prevLinks) => [
          ...prevLinks,
          { page: currentPage, clickedLink: linkUrl }
        ]);
      }
    },
    [currentPage]
  );

  /* -------------------------------------------------------------------------
     GENERAL CLICK HANDLER
     
     - Increments the total click count.
  ------------------------------------------------------------------------- */
  const handleClick = useCallback(() => {
    setTotalClicks((prev) => prev + 1);
  }, []);

  /* -------------------------------------------------------------------------
     PERIODIC ANALYTICS API CALL (Every 15 seconds)
     
     - Every 15 seconds, a consolidated payload is sent.
     - The payload includes context info, page times, clicks, selections, etc.
  ------------------------------------------------------------------------- */
  useEffect(() => {
    const interval = setInterval(() => {
      const finalData = {
        ...analyticsDataRef.current,
        outTime: new Date().toISOString(),
        userId: userId,
        selectedTexts: selectedTexts,
        totalClicks: totalClicks,
        linkClicks: linkClicks,
      };

      const sendAnalyticsData = async () => {
        try {
          const response = await fetch("https://user-view-backend.vercel.app/api/PdfInfo/pdfpageinfo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(finalData),
          });
          if (!response.ok) throw new Error("Network response was not ok");
          const result = await response.json();
          console.log("Periodic analytics data sent successfully:", result);
        } catch (error) {
          console.error("Error sending periodic analytics data:", error);
        }
      };

      sendAnalyticsData();
    }, 15000);

    return () => clearInterval(interval);
  }, [userId, selectedTexts, totalClicks, linkClicks]);

  /* -------------------------------------------------------------------------
     SET UP EVENT LISTENERS: Separate for Mobile and Desktop
     
     - For mobile devices, attach touchend events with throttled callbacks.
     - For desktops, attach events only within the PDF viewer container.
  ------------------------------------------------------------------------- */
  useEffect(() => {
    // Throttled callbacks for mobile devices
    const mobileTextSelection = throttle(handleTextSelection, 500);
    const mobileClickHandler = throttle(handleClick, 500);
    const mobileLinkClick = throttle(handleLinkClick, 500);

    // Desktop callbacks (using the original functions)
    const desktopTextSelection = handleTextSelection;
    const desktopClickHandler = handleClick;
    const desktopLinkClick = handleLinkClick;

    const container = viewerContainerRef.current;
    if (!container) return;

    if (isMobile) {
      container.addEventListener("touchend", mobileTextSelection, { passive: true });
      container.addEventListener("touchend", mobileClickHandler, { passive: true });
      container.addEventListener("touchend", mobileLinkClick, { passive: true });

      return () => {
        container.removeEventListener("touchend", mobileTextSelection);
        container.removeEventListener("touchend", mobileClickHandler);
        container.removeEventListener("touchend", mobileLinkClick);
      };
    } else {
      container.addEventListener("mouseup", desktopTextSelection);
      container.addEventListener("click", desktopClickHandler);
      container.addEventListener("click", desktopLinkClick);

      return () => {
        container.removeEventListener("mouseup", desktopTextSelection);
        container.removeEventListener("click", desktopClickHandler);
        container.removeEventListener("click", desktopLinkClick);
      };
    }
  }, [handleTextSelection, handleClick, handleLinkClick, isMobile]);

  /* -------------------------------------------------------------------------
     RENDER THE PDF VIEWER COMPONENT
     
     - If pdfjs or its worker hasn’t loaded yet, show a loading state.
     - Wrap the PDF viewer in a container with the ref for event attachment.
  ------------------------------------------------------------------------- */
  if (!pdfjs || !pdfjsWorker) {
    return <div>Loading...</div>;
  }

  return (
    <div ref={viewerContainerRef} style={{ height: "100vh", position: "relative" }}>
      <h1 style={{ textAlign: "center", padding: "20px" }}>PDF Viewer</h1>
      <Worker workerUrl={pdfjsWorker}>
        <Viewer
          fileUrl={fileUrl}
          defaultScale={1.5}
          renderMode="canvas"
          onPageChange={handlePageChange}
          plugins={[]}
        />
      </Worker>
    </div>
  );
};

export default MyPdfViewer;
