let currentPage = 1;
let currentSearch = "";
let currentSortBy = "created_date_asc";
let currentFilterType = null;
const PAGE_SIZE = 30;

let synonymOffset = 0;
let antonymOffset = 0;
const SUGGESTION_LIMIT = 5;

// Preload buffers
let preloadedSynonyms = [];
let preloadedAntonyms = [];
let isLoadingSynonyms = false;
let isLoadingAntonyms = false;

// Track if relations list is updating
let isUpdatingRelations = false;

// Load dynamic suggestions with preloading
function loadDynamicSuggestions(type = 'both') {
    if (type === 'both' || type === 'synonym') {
        loadSuggestionType('synonym', synonymOffset);
    }
    if (type === 'both' || type === 'antonym') {
        loadSuggestionType('antonym', antonymOffset);
    }
}

function loadSuggestionType(type, offset) {
    const container = document.getElementById(`${type}_suggestions_container`);
    const forceTag = document.getElementById(`force_tag_${type}`).value.trim();
    const url = `/suggest_relations?limit=${SUGGESTION_LIMIT}&offset=${offset}&type=${type}${forceTag ? '&force_tag=' + encodeURIComponent(forceTag) : ''}`;
    
    if (type === 'synonym') isLoadingSynonyms = true;
    else isLoadingAntonyms = true;
    
    updateLoadMoreButton(type, -1); // Hide during load
    
    fetch(url)
    .then(r => r.json())
    .then(data => {
        if (data.length === 0 && offset === 0) {
            container.innerHTML = "<em>No suggestions available at this time.</em>";
            updateLoadMoreButton(type, 0);
            return;
        }
        
        if (offset === 0) {
            container.innerHTML = "";
        }
        
        data.forEach(suggestion => {
            const div = createSuggestionCard(suggestion);
            container.appendChild(div);
        });
        
        // Preload next batch
        preloadNextSuggestions(type, offset + SUGGESTION_LIMIT);
        
        // Update load more button
        updateLoadMoreButton(type, data.length);
    })
    .finally(() => {
        if (type === 'synonym') isLoadingSynonyms = false;
        else isLoadingAntonyms = false;
    });
}

function preloadNextSuggestions(type, offset) {
    const forceTag = document.getElementById(`force_tag_${type}`).value.trim();
    const url = `/suggest_relations?limit=${SUGGESTION_LIMIT}&offset=${offset}&type=${type}${forceTag ? '&force_tag=' + encodeURIComponent(forceTag) : ''}`;
    
    fetch(url)
    .then(r => r.json())
    .then(data => {
        if (type === 'synonym') {
            preloadedSynonyms = data;
        } else {
            preloadedAntonyms = data;
        }
    });
}

function createSuggestionCard(suggestion) {
    let div = document.createElement("div");
    div.className = "suggestion-card " + suggestion.relation_type;
    div.dataset.suggestionId = `${suggestion.tag1}_${suggestion.tag2}_${suggestion.context_tags || ''}`;
    
    let info = document.createElement("div");
    info.className = "suggestion-info";
    
    let tags = document.createElement("div");
    tags.className = "suggestion-tags " + suggestion.relation_type;
    
    // Format display based on context
    if (suggestion.context_tags) {
        if (suggestion.relation_type === "synonym") {
            tags.textContent = `${suggestion.tag1} (${suggestion.tag1_count}) = ${suggestion.tag2} (${suggestion.tag2_count}) [context: ${suggestion.context_tags}]`;
        } else {
            tags.textContent = `${suggestion.tag1} (${suggestion.tag1_count}) =/= ${suggestion.tag2} (${suggestion.tag2_count}) [context: ${suggestion.context_tags}]`;
        }
    } else {
        if (suggestion.relation_type === "synonym") {
            tags.textContent = `${suggestion.tag1} (${suggestion.tag1_count}) = ${suggestion.tag2} (${suggestion.tag2_count})`;
        } else {
            tags.textContent = `${suggestion.tag1} (${suggestion.tag1_count}) =/= ${suggestion.tag2} (${suggestion.tag2_count})`;
        }
    }
    
    let meta = document.createElement("div");
    meta.className = "suggestion-meta";
    meta.textContent = `Confidence: ${suggestion.confidence}% | Co-occur: ${suggestion.cooccurrence || 0}`;
    
    // Add suggested direction for synonyms
    if (suggestion.relation_type === 'synonym' && suggestion.suggested_direction) {
        let dirHint = document.createElement("span");
        dirHint.className = "direction-hint";
        dirHint.textContent = suggestion.suggested_direction === 'bidirectional' ? ' [Suggested: ↔]' : ' [Suggested: →]';
        meta.appendChild(dirHint);
    }
    
    info.appendChild(tags);
    info.appendChild(meta);
    
    let actions = document.createElement("div");
    actions.className = "suggestion-actions";
    
    let confirmBtn = document.createElement("button");
    confirmBtn.className = "confirm-btn";
    confirmBtn.textContent = "Confirm";
    
    // For synonyms, show direction modal. For antonyms, confirm directly
    if (suggestion.relation_type === 'synonym') {
        confirmBtn.onclick = () => showDirectionModal(suggestion);
    } else {
        confirmBtn.onclick = () => confirmAntonymDirectly(suggestion, div);
    }
    
    let denyBtn = document.createElement("button");
    denyBtn.className = "deny-btn";
    denyBtn.textContent = "Deny";
    denyBtn.onclick = () => denyRelation(suggestion, div);
    
    actions.appendChild(confirmBtn);
    actions.appendChild(denyBtn);
    
    div.appendChild(info);
    div.appendChild(actions);
    
    return div;
}

function createLoadingCard() {
    let div = document.createElement("div");
    div.className = "suggestion-card loading";
    div.innerHTML = '<div class="loading-spinner">Loading...</div>';
    return div;
}

function updateLoadMoreButton(type, loadedCount) {
    const btn = document.getElementById(`load_more_${type}`);
    const isLoading = type === 'synonym' ? isLoadingSynonyms : isLoadingAntonyms;
    
    if (loadedCount === -1 || isLoading) {
        btn.style.display = 'none';
    } else if (loadedCount < SUGGESTION_LIMIT) {
        btn.style.display = 'none';
    } else {
        btn.style.display = 'block';
    }
}

function loadMoreSuggestions(type) {
    if (type === 'synonym') {
        synonymOffset += SUGGESTION_LIMIT;
        loadSuggestionType('synonym', synonymOffset);
    } else {
        antonymOffset += SUGGESTION_LIMIT;
        loadSuggestionType('antonym', antonymOffset);
    }
}

function forceSearchTag(type) {
    if (type === 'synonym') {
        synonymOffset = 0;
        preloadedSynonyms = [];
    } else {
        antonymOffset = 0;
        preloadedAntonyms = [];
    }
    loadSuggestionType(type, 0);
}

function confirmAntonymDirectly(suggestion, cardElement) {
    // Antonyms have no direction, confirm immediately
    replaceSuggestionCard(cardElement, suggestion.relation_type);
    
    fetch("/confirm_relation", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            tag1: suggestion.tag1,
            tag2: suggestion.tag2,
            tag1_count: suggestion.tag1_count,
            tag2_count: suggestion.tag2_count,
            relation_type: suggestion.relation_type,
            context_tags: suggestion.context_tags || "",
            bidirectional: false, // Antonyms have no direction
            user_swapped: false,
            cooccurrence: suggestion.cooccurrence || 0,
            calculation: suggestion.calculation || ""
        })
    })
    .then(() => {
        if (!isUpdatingRelations) {
            loadConfirmedRelations(currentPage);
        }
    });
}

function showDirectionModal(suggestion) {
    let modal = document.getElementById("direction_modal");
    let tag1Span = document.getElementById("modal_tag1");
    let tag2Span = document.getElementById("modal_tag2");
    let symbolSpan = document.getElementById("modal_symbol");
    
    tag1Span.textContent = suggestion.tag1;
    tag2Span.textContent = suggestion.tag2;
    
    document.getElementById("modal_tag1_copy").textContent = suggestion.tag1;
    document.getElementById("modal_tag2_copy").textContent = suggestion.tag2;
    document.getElementById("modal_tag1_rev").textContent = suggestion.tag1;
    document.getElementById("modal_tag2_rev").textContent = suggestion.tag2;
    
    symbolSpan.textContent = "=";
    symbolSpan.className = "modal-symbol synonym";
    
    // Pre-select suggested direction
    if (suggestion.suggested_direction === 'bidirectional') {
        document.querySelectorAll('.direction-option').forEach(opt => opt.classList.remove('suggested'));
        document.querySelector('.direction-option[data-dir="bidirectional"]').classList.add('suggested');
    } else if (suggestion.suggested_direction === 'one_way') {
        document.querySelectorAll('.direction-option').forEach(opt => opt.classList.remove('suggested'));
        document.querySelector('.direction-option[data-dir="oneway"]').classList.add('suggested');
    }
    
    modal.style.display = "flex";
    modal.dataset.suggestion = JSON.stringify(suggestion);
}

function closeDirectionModal() {
    document.getElementById("direction_modal").style.display = "none";
}

function confirmWithDirection(bidirectional, swapped = false) {
    let modal = document.getElementById("direction_modal");
    let suggestion = JSON.parse(modal.dataset.suggestion);
    
    let tag1 = swapped ? suggestion.tag2 : suggestion.tag1;
    let tag2 = swapped ? suggestion.tag1 : suggestion.tag2;
    let tag1_count = swapped ? suggestion.tag2_count : suggestion.tag1_count;
    let tag2_count = swapped ? suggestion.tag1_count : suggestion.tag2_count;
    
    closeDirectionModal();
    
    // Find and replace the card
    const cardId = `${suggestion.tag1}_${suggestion.tag2}_${suggestion.context_tags || ''}`;
    const container = document.getElementById('synonym_suggestions_container');
    const oldCard = container.querySelector(`[data-suggestion-id="${cardId}"]`);
    
    if (oldCard) {
        replaceSuggestionCard(oldCard, 'synonym');
    }
    
    fetch("/confirm_relation", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            tag1: tag1,
            tag2: tag2,
            tag1_count: tag1_count,
            tag2_count: tag2_count,
            relation_type: suggestion.relation_type,
            context_tags: suggestion.context_tags || "",
            bidirectional: bidirectional,
            user_swapped: swapped,
            cooccurrence: suggestion.cooccurrence || 0,
            calculation: suggestion.calculation || ""
        })
    })
    .then(() => {
        if (!isUpdatingRelations) {
            loadConfirmedRelations(currentPage);
        }
    });
}

function replaceSuggestionCard(oldCard, type) {
    const container = oldCard.parentNode;
    const preloaded = type === 'synonym' ? preloadedSynonyms.shift() : preloadedAntonyms.shift();
    
    if (preloaded) {
        const newCard = createSuggestionCard(preloaded);
        container.replaceChild(newCard, oldCard);
        
        // Preload another
        const offset = type === 'synonym' ? synonymOffset : antonymOffset;
        preloadNextSuggestions(type, offset + SUGGESTION_LIMIT + (type === 'synonym' ? preloadedSynonyms.length : preloadedAntonyms.length));
    } else {
        // Show loading card
        const loadingCard = createLoadingCard();
        container.replaceChild(loadingCard, oldCard);
        
        // Load one more
        const offset = type === 'synonym' ? synonymOffset : antonymOffset;
        const currentCount = container.querySelectorAll('.suggestion-card:not(.loading)').length;
        
        fetch(`/suggest_relations?limit=1&offset=${offset + currentCount}&type=${type}`)
        .then(r => r.json())
        .then(data => {
            if (data.length > 0) {
                const newCard = createSuggestionCard(data[0]);
                container.replaceChild(newCard, loadingCard);
            } else {
                loadingCard.remove();
            }
        });
    }
}

function denyRelation(suggestion, cardElement) {
    replaceSuggestionCard(cardElement, suggestion.relation_type);
    
    fetch("/deny_relation", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            tag1: suggestion.tag1,
            tag2: suggestion.tag2
        })
    });
}

function loadConfirmedRelations(page = 1) {
    isUpdatingRelations = true;
    currentPage = page;
    const url = `/list_relations?page=${page}&page_size=${PAGE_SIZE}&search=${encodeURIComponent(currentSearch)}&sort_by=${currentSortBy}${currentFilterType ? '&filter_type=' + currentFilterType : ''}`;
    
    fetch(url)
    .then(r => r.json())
    .then(data => {
        let container = document.getElementById("relations_container");
        container.innerHTML = "";
        
        // Update stats display
        updateStatsDisplay(data.stats);
        
        if (data.relations.length === 0) {
            container.innerHTML = "<em>No relations found.</em>";
            document.getElementById("pagination").innerHTML = "";
            return;
        }
        
        data.relations.forEach(rel => {
            const div = createRelationCard(rel);
            container.appendChild(div);
        });
        
        renderPagination(data.total_pages);
    })
    .finally(() => {
        isUpdatingRelations = false;
    });
}

function updateStatsDisplay(stats) {
    const statsEl = document.getElementById("relation_stats");
    if (!stats) return;
    
    let text = "";
    if (currentFilterType) {
        const filterName = currentFilterType.charAt(0).toUpperCase() + currentFilterType.slice(1);
        text = `${(stats[currentFilterType] || 0).toLocaleString()} ${filterName} Relations`;
    } else {
        text = `${(stats.total || 0).toLocaleString()} Total Relations`;
    }
    
    statsEl.textContent = text;
}

function createRelationCard(rel) {
    let div = document.createElement("div");
    div.className = "relation-item " + rel.relation_type;
    
    // Create icon based on relation type and structure
    let icon = document.createElement("span");
    icon.className = "relation-icon " + rel.relation_type;
    
    const tag1Multi = rel.tag1.includes(' ');
    const tag2Multi = rel.tag2.includes(' ');
    
    if (rel.relation_type === "synonym") {
        if (rel.bidirectional) {
            icon.innerHTML = tag1Multi || tag2Multi ? "⇄" : "↔";
        } else {
            icon.innerHTML = "→";
        }
    } else if (rel.relation_type === "antonym") {
        icon.innerHTML = "⊗";
    } else {
        icon.innerHTML = "~";
    }
    icon.title = rel.relation_type;
    
    // Tags display
    let tags = document.createElement("span");
    tags.className = "relation-tags";
    
    const formatTag = (tag, count) => {
        const parts = tag.split(' ');
        if (parts.length > 1) {
            return `<strong>[${parts.join(' + ')}]</strong> (${count})`;
        }
        return `<strong>${tag}</strong> (${count})`;
    };
    
    if (rel.relation_type === "synonym") {
        tags.innerHTML = `${formatTag(rel.tag1, rel.tag1_current_count)} ${icon.innerHTML} ${formatTag(rel.tag2, rel.tag2_current_count)}`;
    } else if (rel.relation_type === "antonym") {
        const contextDisplay = rel.context_tags ? ` <span class="context-badge">[${rel.context_tags}]</span>` : '';
        tags.innerHTML = `${formatTag(rel.tag1, rel.tag1_current_count)} ⊗ ${formatTag(rel.tag2, rel.tag2_current_count)}${contextDisplay}`;
    } else {
        tags.innerHTML = `${formatTag(rel.tag1, rel.tag1_current_count)} ~ ${formatTag(rel.tag2, rel.tag2_current_count)}`;
    }
    
    // Show More button
    let showMoreBtn = document.createElement("button");
    showMoreBtn.className = "show-more-btn";
    showMoreBtn.textContent = "Show More";
    showMoreBtn.onclick = () => toggleCalculationDetails(rel.id, showMoreBtn);
    
    let calculationDiv = document.createElement("div");
    calculationDiv.className = "calculation-details";
    calculationDiv.id = `calc_${rel.id}`;
    calculationDiv.style.display = "none";
    
    div.appendChild(icon);
    
    let contentDiv = document.createElement("div");
    contentDiv.className = "relation-content";
    contentDiv.appendChild(tags);
    contentDiv.appendChild(showMoreBtn);
    contentDiv.appendChild(calculationDiv);
    div.appendChild(contentDiv);
    
    // Actions
    let actions = document.createElement("div");
    actions.className = "relation-actions";
    
    let typeBtn = document.createElement("button");
    typeBtn.className = "type-btn";
    typeBtn.textContent = rel.relation_type === 'synonym' ? '=' : (rel.relation_type === 'antonym' ? '=/=' : '~');
    typeBtn.title = "Change relation type";
    typeBtn.onclick = () => showTypeModal(rel);
    
    if (rel.relation_type === 'synonym') {
        let dirBtn = document.createElement("button");
        dirBtn.className = "direction-btn";
        dirBtn.textContent = rel.bidirectional ? "↔" : "→";
        dirBtn.title = rel.bidirectional ? "Bidirectional" : "One-way";
        dirBtn.onclick = () => toggleDirection(rel.id, !rel.bidirectional);
        actions.appendChild(dirBtn);
        
        if (!rel.bidirectional) {
            let swapBtn = document.createElement("button");
            swapBtn.className = "swap-btn";
            swapBtn.textContent = "⇄";
            swapBtn.title = "Reverse direction";
            swapBtn.onclick = () => swapRelation(rel.id);
            actions.appendChild(swapBtn);
        }
    }
    
    let deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-relation-btn";
    deleteBtn.textContent = "×";
    deleteBtn.title = "Delete";
    deleteBtn.onclick = () => deleteRelation(rel.id);
    
    actions.appendChild(typeBtn);
    actions.appendChild(deleteBtn);
    div.appendChild(actions);
    
    return div;
}

function toggleCalculationDetails(relId, btn) {
    const calcDiv = document.getElementById(`calc_${relId}`);
    
    if (calcDiv.style.display === "none") {
        // Show loading
        calcDiv.innerHTML = '<div class="loading-spinner">Loading chart...</div>';
        calcDiv.style.display = "block";
        btn.textContent = "Show Less";
        
        // Fetch chart data
        fetch(`/relation_chart_data/${relId}`)
        .then(r => r.json())
        .then(data => {
            calcDiv.innerHTML = `
                <div class="calc-info">
                    <div><strong>Overlap:</strong> ${data.overlap_percentage}%</div>
                    <div><strong>Co-occurrence:</strong> ${data.cooccurrence}</div>
                </div>
                <div class="venn-chart">
                    <svg viewBox="0 0 200 100" width="200" height="100">
                        <circle cx="60" cy="50" r="35" fill="rgba(76, 175, 80, 0.3)" stroke="#4CAF50" stroke-width="2"/>
                        <circle cx="140" cy="50" r="35" fill="rgba(33, 150, 243, 0.3)" stroke="#2196F3" stroke-width="2"/>
                        <text x="45" y="30" font-size="10" fill="#333">${data.tag1}</text>
                        <text x="100" y="55" font-size="12" font-weight="bold" text-anchor="middle" fill="#333">${data.cooccurrence}</text>
                        <text x="155" y="30" font-size="10" fill="#333" text-anchor="end">${data.tag2}</text>
                        <text x="40" y="55" font-size="10" fill="#666">${data.tag1_only}</text>
                        <text x="160" y="55" font-size="10" fill="#666">${data.tag2_only}</text>
                    </svg>
                </div>
            `;
        })
        .catch(() => {
            calcDiv.innerHTML = '<div>Error loading chart data</div>';
        });
    } else {
        calcDiv.style.display = "none";
        btn.textContent = "Show More";
    }
}

function showTypeModal(relation) {
    const modal = document.getElementById("type_modal");
    modal.dataset.relationId = relation.id;
    modal.dataset.currentType = relation.relation_type;
    
    document.getElementById("type_modal_tag1").textContent = relation.tag1;
    document.getElementById("type_modal_tag2").textContent = relation.tag2;
    document.getElementById("type_modal_current").textContent = relation.relation_type;
    
    modal.style.display = "flex";
}

function closeTypeModal() {
    document.getElementById("type_modal").style.display = "none";
}

function changeRelationType(newType) {
    const modal = document.getElementById("type_modal");
    const relationId = modal.dataset.relationId;
    const currentType = modal.dataset.currentType;
    
    if (newType === currentType) {
        closeTypeModal();
        return;
    }
    
    fetch("/update_relation_type", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            id: relationId,
            type: newType
        })
    })
    .then(() => {
        closeTypeModal();
        loadConfirmedRelations(currentPage);
    });
}

function renderPagination(totalPages) {
    let pag = document.getElementById("pagination");
    pag.innerHTML = "";
    
    if (totalPages <= 1) return;
    
    if (currentPage > 1) {
        let firstBtn = document.createElement("button");
        firstBtn.className = "page-btn";
        firstBtn.textContent = "<<";
        firstBtn.onclick = () => loadConfirmedRelations(1);
        pag.appendChild(firstBtn);
        
        let prevBtn = document.createElement("button");
        prevBtn.className = "page-btn";
        prevBtn.textContent = "<";
        prevBtn.onclick = () => loadConfirmedRelations(currentPage - 1);
        pag.appendChild(prevBtn);
    }
    
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, currentPage + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        let btn = document.createElement("button");
        btn.className = "page-btn";
        btn.textContent = i;
        if (i === currentPage) {
            btn.disabled = true;
            btn.style.fontWeight = "bold";
        }
        btn.onclick = () => loadConfirmedRelations(i);
        pag.appendChild(btn);
    }
    
    if (currentPage < totalPages) {
        let nextBtn = document.createElement("button");
        nextBtn.className = "page-btn";
        nextBtn.textContent = ">";
        nextBtn.onclick = () => loadConfirmedRelations(currentPage + 1);
        pag.appendChild(nextBtn);
        
        let lastBtn = document.createElement("button");
        lastBtn.className = "page-btn";
        lastBtn.textContent = ">>";
        lastBtn.onclick = () => loadConfirmedRelations(totalPages);
        pag.appendChild(lastBtn);
    }
}

function toggleDirection(id, bidirectional) {
    fetch("/update_relation_direction", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({id: id, bidirectional: bidirectional, swap: false})
    })
    .then(() => loadConfirmedRelations(currentPage));
}

function swapRelation(id) {
    fetch("/update_relation_direction", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({id: id, bidirectional: false, swap: true})
    })
    .then(() => loadConfirmedRelations(currentPage));
}

function deleteRelation(id) {
    if (!confirm("Delete this relation?")) return;
    fetch("/delete_relation", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({id: id})
    })
    .then(() => loadConfirmedRelations(currentPage));
}

function searchRelations() {
    currentSearch = document.getElementById("search_bar").value.trim();
    loadConfirmedRelations(1);
}

function changeSortBy() {
    currentSortBy = document.getElementById("sort_by").value;
    localStorage.setItem('relations_sort', currentSortBy);
    loadConfirmedRelations(1);
}

function changeFilterType() {
    const value = document.getElementById("filter_type").value;
    currentFilterType = value === 'all' ? null : value;
    localStorage.setItem('relations_filter', currentFilterType || 'all');
    loadConfirmedRelations(1);
}

function addManualRelation() {
    const input = document.getElementById("manual_relation_input").value.trim();
    if (!input) return;
    
    let tag1, tag2, relationType = 'synonym';
    
    if (input.includes('=/=')) {
        [tag1, tag2] = input.split('=/=').map(t => t.trim());
        relationType = 'antonym';
    } else if (input.includes('=')) {
        [tag1, tag2] = input.split('=').map(t => t.trim());
        relationType = 'synonym';
    } else {
        const parts = input.split(/\s+/);
        if (parts.length < 2) {
            alert("Invalid format. Use: 'tag1 tag2' or 'tag1=tag2' or 'tag1=/=tag2'");
            return;
        }
        
        // Check if this is a contextual relation (3+ tags)
        if (parts.length >= 3) {
            // Assume last tag is the second side, rest is first side
            tag2 = parts[parts.length - 1];
            tag1 = parts.slice(0, -1).join(' ');
        } else {
            [tag1, tag2] = parts;
        }
    }
    
    if (!tag1 || !tag2) {
        alert("Both tags must be specified");
        return;
    }
    
    const suggestion = {
        tag1: tag1,
        tag2: tag2,
        tag1_count: 0,
        tag2_count: 0,
        relation_type: relationType,
        confidence: 0,
        context_tags: "",
        cooccurrence: 0,
        calculation: "Manually added",
        suggested_direction: "bidirectional"
    };
    
    if (relationType === 'synonym') {
        showDirectionModal(suggestion);
    } else {
        confirmAntonymDirectly(suggestion, null);
    }
    
    document.getElementById("manual_relation_input").value = "";
}

// Event listeners
document.getElementById("search_bar").addEventListener("keypress", (e) => {
    if (e.key === "Enter") searchRelations();
});

document.getElementById("manual_relation_input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") addManualRelation();
});

window.onclick = function(event) {
    let dirModal = document.getElementById("direction_modal");
    let typeModal = document.getElementById("type_modal");
    if (event.target === dirModal) closeDirectionModal();
    if (event.target === typeModal) closeTypeModal();
}

// Restore preferences from localStorage
window.onload = () => {
    const savedSort = localStorage.getItem('relations_sort');
    const savedFilter = localStorage.getItem('relations_filter');
    
    if (savedSort) {
        currentSortBy = savedSort;
        document.getElementById("sort_by").value = savedSort;
    }
    
    if (savedFilter && savedFilter !== 'all') {
        currentFilterType = savedFilter;
        document.getElementById("filter_type").value = savedFilter;
    }
    
    loadDynamicSuggestions('both');
    loadConfirmedRelations(1);
};