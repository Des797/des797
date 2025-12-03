let currentOffset = 0;
let currentSuggestions = [];
let typingTimer;
let typingDelay = 400;
const SUGGESTIONS_PER_PAGE = 10;
const suggestionContainer = document.getElementById("suggestions_list");
const mergeButton = document.getElementById("merge_button");

// Auto-fetch suggestions when typing stops
document.getElementById("tags").addEventListener("input", () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        currentOffset = 0;
        fetchSuggestions(false);
    }, typingDelay);
});

// Fetch suggestions from server
function fetchSuggestions(append = false) {
    let tags = document.getElementById("tags").value.split(/\s+/).filter(t => t.trim().length > 0);
    if (tags.length === 0) {
        suggestionContainer.innerHTML = "<em>Type tags to see suggestions</em>";
        return;
    }

    suggestionContainer.parentElement.classList.add("loading");

    fetch("/suggest", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            tags: tags,
            top_n: SUGGESTIONS_PER_PAGE,
            offset: currentOffset
        })
    })
    .then(r => r.json())
    .then(data => {
        if (!append) currentSuggestions = data.suggestions;
        else currentSuggestions = currentSuggestions.concat(data.suggestions);

        displaySuggestions();
        document.getElementById("load_more_button").style.display = data.has_more ? "inline-block" : "none";
    })
    .finally(() => {
        suggestionContainer.parentElement.classList.remove("loading");
    });
}

// Display suggestions as chips with smooth FLIP animation
function displaySuggestions() {
    const previousRects = new Map();
    const previousIndex = new Map();

    // Capture previous positions and indices
    suggestionContainer.querySelectorAll(".suggestion-chip").forEach((chip, idx) => {
        previousRects.set(chip.dataset.tag, chip.getBoundingClientRect());
        previousIndex.set(chip.dataset.tag, idx);
    });

    suggestionContainer.innerHTML = "";
    const chips = [];

    currentSuggestions.forEach((s, i) => {
        const chip = document.createElement("div");
        chip.className = "suggestion-chip" + (s.is_synonym ? " synonym" : "");
        chip.dataset.tag = s.tag;
        chip.textContent = s.tag; // No percentages

        // Highlight if moved up
        if (previousIndex.has(s.tag) && previousIndex.get(s.tag) > i) {
            chip.classList.add("moved-up");
        }

        // Preserve selection if previously selected
        const previouslySelected = document.querySelector(`.suggestion-chip[data-tag="${s.tag}"]`)?.classList.contains("selected");
        if (previouslySelected) chip.classList.add("selected");

        // Click toggle selection
        chip.addEventListener("click", () => {
            chip.classList.toggle("selected");
            updateMergeButton();
        });

        chips.push(chip);
        suggestionContainer.appendChild(chip);
    });

    // FLIP animation
    requestAnimationFrame(() => {
        chips.forEach(chip => {
            const first = previousRects.get(chip.dataset.tag);
            if (first) {
                const last = chip.getBoundingClientRect();
                const invertX = first.left - last.left;
                const invertY = first.top - last.top;
                chip.style.transform = `translate(${invertX}px, ${invertY}px)`;
                chip.style.transition = 'transform 0s';
                requestAnimationFrame(() => {
                    chip.style.transform = '';
                    chip.style.transition = 'transform 0.3s ease';
                });
            } else {
                // Newly added chip fade/scale in
                chip.style.opacity = 0;
                chip.style.transform = 'scale(0.96)';
                requestAnimationFrame(() => {
                    chip.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
                    chip.style.transform = 'scale(1)';
                    chip.style.opacity = 1;
                });
            }
        });
    });

    updateMergeButton();
}


// Merge selected chips into tags textarea
function mergeSelectedTags() {
    const selectedChips = document.querySelectorAll(".suggestion-chip.selected");
    if (selectedChips.length === 0) return;

    let selectedTags = Array.from(selectedChips).map(c => c.dataset.tag);
    let currentTags = document.getElementById("tags").value.split(/\s+/).filter(t => t.trim().length > 0);
    let newTags = Array.from(new Set([...selectedTags, ...currentTags]));

    document.getElementById("tags").value = newTags.join(" ") + " ";

    // Clear selection and refresh suggestions
    selectedChips.forEach(c => c.classList.remove("selected"));
    updateMergeButton();
    currentOffset = 0;
    fetchSuggestions(false);
}

// Update merge button counter
function updateMergeButton() {
    const selectedCount = document.querySelectorAll(".suggestion-chip.selected").length;
    mergeButton.textContent = "Merge Selected Suggestions" + (selectedCount > 0 ? ` (${selectedCount})` : '');
}

// Load more suggestions
function loadMoreSuggestions() {
    currentOffset += SUGGESTIONS_PER_PAGE;
    fetchSuggestions(true);
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
    initDragDrop();
    fetchSuggestions();
});


// === MANUAL OBJECT ADD ===
function addManualObject() {
    let input = document.getElementById("manual_object").value.trim();
    if (!input) {
        alert("Enter some tags or JSON.");
        return;
    }

    let tagsArray = [];
    try {
        if (input.startsWith("{")) {
            let parsed = JSON.parse(input);
            if (!parsed.tags) throw "Missing tags";
            tagsArray = parsed.tags.split(/\s+/).filter(t => t.trim().length > 0);
        } else {
            tagsArray = input.split(/\s+/).filter(t => t.trim().length > 0);
        }
        if (tagsArray.length === 0) throw "No tags found";

        fetch("/add_object", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({tags: tagsArray})
        }).then(r => r.json())
          .then(data => {
              document.getElementById("manual_output").innerText = `Added object with ID: ${data.id}`;
              document.getElementById("manual_object").value = "";
          })
          .catch(e => alert("Error adding object: " + e));
    } catch (e) {
        alert("Invalid input: " + e);
    }
}

// === SESSION REVERT ===
function revertSession() {
    if (!confirm("This will undo all adds/deletes made in this session. Continue?")) return;
    fetch("/revert_session", {method: "POST", headers: {"Content-Type": "application/json"}})
    .then(r => r.json())
    .then(data => {
        document.getElementById("session_output").innerText = 
            "Reverted: " + JSON.stringify(data.reverted, null, 2);
    });
}

// DRAG & DROP AND FILE HANDLERS — unchanged except call handleTagsUpdated() after programmatic tags changes
function initDragDrop() {
    const dropArea = document.getElementById("drop_area");
    const fileInput = document.getElementById("file_input");
    const progressContainer = document.getElementById("progress-container");
    const progressBar = document.getElementById("progress-bar");

    if (!dropArea) return;

    dropArea.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", e => handleFiles(e.target.files));

    dropArea.addEventListener("dragover", e => { 
        e.preventDefault(); 
        dropArea.style.borderColor = "#333"; 
    });
    dropArea.addEventListener("dragleave", e => { 
        e.preventDefault(); 
        dropArea.style.borderColor = "#aaa"; 
    });
    dropArea.addEventListener("drop", e => { 
        e.preventDefault(); 
        dropArea.style.borderColor = "#aaa"; 
        handleFiles(e.dataTransfer.files); 
    });

    function handleFiles(files) {
        files = Array.from(files);
        if (files.length === 0) return;

        progressContainer.style.display = "block";
        let processed = 0;

        function updateProgress() {
            let pct = Math.round((processed / files.length) * 100);
            progressBar.style.width = pct + "%";
            progressBar.innerText = pct + "%";
        }

        function next() {
            if (files.length === 0) {
                progressBar.style.width = "100%";
                progressBar.innerText = "Done!";
                setTimeout(() => {
                    progressContainer.style.display = "none";
                }, 1200);
                return;
            }

            let file = files.shift();
            const ext = file.name.split('.').pop().toLowerCase();
            const reader = new FileReader();

            reader.onload = event => {
                if (ext === "json" || ext === "xmp") {
                    let text = event.target.result;

                    if (ext === "json") {
                        let parsed = JSON.parse(text);
                        let objectList = [];

                        if (Array.isArray(parsed)) {
                            parsed.forEach(obj => {
                                if (obj && obj.tags) {
                                    let arr = obj.tags.split(/\s+/).filter(t => t.trim().length > 0);
                                    if (arr.length) objectList.push(arr);
                                }
                            });
                        } else if (parsed && parsed.tags) {
                            let arr = parsed.tags.split(/\s+/).filter(t => t.trim().length > 0);
                            if (arr.length) objectList.push(arr);
                        }

                        if (objectList.length > 0) {
                            let chain = Promise.resolve();
                            objectList.forEach(tagList => {
                                chain = chain.finally(() => 
                                    fetch("/add_object", {
                                        method: "POST",
                                        headers: {"Content-Type": "application/json"},
                                        body: JSON.stringify({tags: tagList})
                                    })
                                );
                            });
                            chain.finally(() => {
                                processed++;
                                updateProgress();
                                next();
                            });
                            return;
                        }
                    } else if (ext === "xmp") {
                        const liMatches = [...text.matchAll(/<rdf:li>(.*?)<\/rdf:li>/gi)];
                        let tagsArray = liMatches.map(m => m[1].trim()).filter(t => t.length > 0);
                        if (tagsArray.length > 0) {
                            fetch("/add_object", {
                                method: "POST",
                                headers: {"Content-Type": "application/json"},
                                body: JSON.stringify({tags: tagsArray})
                            }).finally(() => {
                                processed++;
                                updateProgress();
                                next();
                            });
                            return;
                        }
                    }
                    processed++;
                    updateProgress();
                    next();
                }
                else if (['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(ext)) {
                    const formData = new FormData();
                    formData.append("image", file);

                    fetch("/suggest_from_image", {
                        method: "POST",
                        body: formData
                    })
                    .then(r => r.json())
                    .then(data => {
                        if (data.tags && data.tags.length > 0) {
                            let existing = tagsInputEl.value.split(/\s+/).filter(t => t.trim().length > 0);
                            let combined = Array.from(new Set([...existing, ...data.tags]));
                            tagsInputEl.value = combined.join(" ") + " ";
                            handleTagsUpdated();
                            fetchSuggestions();
                        }
                    })
                    .finally(() => {
                        processed++;
                        updateProgress();
                        next();
                    });
                } else {
                    processed++;
                    updateProgress();
                    next();
                }
            };

            if (['json', 'xmp'].includes(ext)) {
                reader.readAsText(file);
            } else if (['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(ext)) {
                reader.readAsArrayBuffer(file);
            } else {
                processed++;
                updateProgress();
                next();
            }
        }

        next();
    }
}

/* =========================
   FLIP animation utilities
   =========================
   - animateSuggestionUpdate(oldList, newList)
   - oldList/newList are arrays of suggestion objects with .tag
*/
function animateSuggestionUpdate(oldList, newList) {
    // create maps tag -> DOM element & positions (from existing DOM)
    const oldFlow = suggestionsListEl ? suggestionsListEl.querySelector(".suggestions-flow") : null;
    const oldEls = oldFlow ? Array.from(oldFlow.children) : [];

    // capture previous positions keyed by tag
    const prevRects = {};
    oldEls.forEach(el => {
        prevRects[el.dataset.tag] = el.getBoundingClientRect();
    });

    // compute new ordering elements (in-memory) but do not attach yet
    const newFlow = document.createElement("div");
    newFlow.className = "suggestions-flow";
    newList.forEach(s => {
        const el = createSuggestionChip(s);
        newFlow.appendChild(el);
    });

    // replace old flow with newFlow but keep oldEls in the document to capture animation
    // strategy: keep oldFlow in DOM but insert newFlow, then compute deltas and animate
    if (!suggestionsListEl) return;

    const loading = document.getElementById("suggestions_loading");
    // temporarily detach old flow but keep its elements for measurements
    if (oldFlow) oldFlow.style.visibility = "hidden";
    suggestionsListEl.appendChild(newFlow);

    // after DOM insertion, capture new positions
    const newEls = Array.from(newFlow.children);
    const newRects = {};
    newEls.forEach(el => {
        newRects[el.dataset.tag] = el.getBoundingClientRect();
    });

    // For smooth FLIP we need to compute transforms for each element:
    // If element existed before and after, compute delta and animate from old -> new.
    // For elements that are new (not in prevRects) we can fade/scale in.
    // For elements that were removed, we animate old element out and then remove.

    // Prepare z-index layering: upward movers (new index < old index) highest, stagnant mid, downward lowest
    const oldIndexMap = {};
    oldList.forEach((s, i) => oldIndexMap[s.tag] = i);
    const newIndexMap = {};
    newList.forEach((s, i) => newIndexMap[s.tag] = i);

    // put a snapshot layer of old elements (absolute positioned) so they can animate independently
    const snapshotLayer = document.createElement("div");
    snapshotLayer.style.position = "relative";
    snapshotLayer.style.width = "100%";
    snapshotLayer.style.minHeight = "1px";
    // place it above newFlow so transforms overlay nicely
    suggestionsListEl.appendChild(snapshotLayer);

    // create shadow clones for old elements to animate out/move
    const clones = {};
    oldEls.forEach(oldEl => {
        const tag = oldEl.dataset.tag;
        const rect = prevRects[tag];
        const clone = oldEl.cloneNode(true);
        // style clone as absolute positioned
        clone.style.position = "absolute";
        clone.style.left = (rect.left - suggestionsListEl.getBoundingClientRect().left) + "px";
        clone.style.top = (rect.top - suggestionsListEl.getBoundingClientRect().top) + "px";
        clone.style.width = rect.width + "px";
        clone.style.height = rect.height + "px";
        clone.style.margin = "0";
        clone.dataset.tag = tag;
        snapshotLayer.appendChild(clone);
        clones[tag] = clone;
    });

    // hide the newFlow initially visually by setting opacity 0 so we can animate clones into place
    newFlow.style.opacity = "0";

    // Force layout so we have correct positions
    void suggestionsListEl.offsetWidth;

    // Animate clones to their new positions / fade out or in
    const animations = [];

    // For each clone (from old set), determine if tag exists in newRects
    Object.keys(clones).forEach(tag => {
        const clone = clones[tag];
        const oldRect = prevRects[tag];
        const newRect = newRects[tag];

        // classify movement
        const oldIdx = typeof oldIndexMap[tag] === "number" ? oldIndexMap[tag] : null;
        const newIdx = typeof newIndexMap[tag] === "number" ? newIndexMap[tag] : null;

        let zOrder = 2; // stagnant default
        if (oldIdx !== null && newIdx !== null) {
            if (newIdx < oldIdx) zOrder = 3;      // moved up -> highest
            else if (newIdx > oldIdx) zOrder = 1; // moved down -> lowest
            else zOrder = 2;                      // stagnant
        } else if (newIdx === null) {
            // removed entirely -> lowest
            zOrder = 1;
        }

        clone.style.zIndex = String(100 + zOrder);
        if (newRect) {
            // compute delta
            const dx = newRect.left - oldRect.left;
            const dy = newRect.top - oldRect.top;
            // animate translate from 0 to dx,dy (we'll invert: set transform to 0 then animate)
            clone.animate([
                { transform: 'translate(0px, 0px)', opacity: 1 },
                { transform: `translate(${dx}px, ${dy}px)`, opacity: 1 }
            ], {
                duration: FLIP_DURATION,
                easing: 'cubic-bezier(.2,.8,.2,1)'
            });
        } else {
            // animate fade & slide up slightly
            clone.animate([
                { transform: 'translateY(0px)', opacity: 1 },
                { transform: 'translateY(-8px)', opacity: 0 }
            ], {
                duration: FLIP_DURATION * 0.9,
                easing: 'ease-out'
            });
        }
    });

    // For new elements that did not exist before: fade/scale in
    newEls.forEach(newEl => {
        const tag = newEl.dataset.tag;
        if (!prevRects[tag]) {
            newEl.style.opacity = '0';
            newEl.animate([
                { transform: 'scale(0.96)', opacity: 0 },
                { transform: 'scale(1)', opacity: 1 }
            ], {
                duration: FLIP_DURATION,
                easing: 'cubic-bezier(.2,.8,.2,1)',
                fill: 'forwards'
            });
        }
    });

    // after animation time, tidy up: remove clones and reveal newFlow fully
    setTimeout(() => {
        // remove snapshot layer
        snapshotLayer.remove();
        // remove old flow if present
        if (oldFlow) oldFlow.remove();
        // ensure newFlow visible
        newFlow.style.opacity = "1";
        // re-apply selected states (in case newFlow elements created fresh)
        markDisplayedSelected();
        updateMergeButton();
    }, FLIP_DURATION + 20);
}
