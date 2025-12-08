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
let processedSuggestions = new Set(); 

let relationsCache = null;
let relationsCacheTime = 0;
const CACHE_DURATION = 5000; // 5 seconds

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
            if (div !== null) {  // Skip already processed suggestions
                container.appendChild(div);
            }
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
    // Skip if already processed
    const suggestionKey = `${suggestion.tag1}|${suggestion.tag2}|${suggestion.context_tags || ''}`;
    if (processedSuggestions.has(suggestionKey)) {
        return null; // Signal to skip this card
    }
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
    processedSuggestions.clear();
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
    const suggestionKey = `${suggestion.tag1}|${suggestion.tag2}|${suggestion.context_tags || ''}`;
    processedSuggestions.add(suggestionKey);
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
    relationsCache = null; // Invalidate cache
    .then(() => {
        loadConfirmedRelations(currentPage);
    })
    .catch(err => console.error('Error confirming relation:', err));
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
    const suggestionKey = `${suggestion.tag1}|${suggestion.tag2}|${suggestion.context_tags || ''}`;
    processedSuggestions.add(suggestionKey);
    
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
    relationsCache = null; // Invalidate cache
    .then(() => {
        loadConfirmedRelations(currentPage);
    })
    .catch(err => console.error('Error confirming relation:', err));
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
    const suggestionKey = `${suggestion.tag1}|${suggestion.tag2}|${suggestion.context_tags || ''}`;
    processedSuggestions.add(suggestionKey);
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

function loadConfirmedRelations(page = 1, forceReload = false) {
    isUpdatingRelations = true;
    currentPage = page;
    const url = `/list_relations?page=${page}&page_size=${PAGE_SIZE}&search=${encodeURIComponent(currentSearch)}&sort_by=${currentSortBy}${currentFilterType ? '&filter_type=' + currentFilterType : ''}`;
    
    // Use cache if available and fresh
    const now = Date.now();
    if (!forceReload && relationsCache && (now - relationsCacheTime) < CACHE_DURATION) {
        renderRelations(relationsCache);
        isUpdatingRelations = false;
        return;
    }
    
    fetch(url)
    .then(r => r.json())
    .then(data => {
        relationsCache = data;
        relationsCacheTime = Date.now();
        renderRelations(data);
    })
    .catch(err => console.error('Error loading relations:', err))
    .finally(() => {
        isUpdatingRelations = false;
    });
}

function renderRelations(data) {
    let container = document.getElementById("relations_container");
    container.innerHTML = "";
    
    // Update stats display
    updateStatsDisplay(data.stats);
    
    if (data.relations.length === 0) {
        container.innerHTML = "<em>No relations found.</em>";
        document.getElementById("pagination").innerHTML = "";
        return;
    }
    
    // Group synonyms into clusters
    const synonymClusters = buildSynonymClusters(data.relations.filter(r => r.relation_type === 'synonym'));
    const otherRelations = data.relations.filter(r => r.relation_type !== 'synonym');
    
    // Render synonym clusters first
    synonymClusters.forEach(cluster => {
        const div = createSynonymClusterCard(cluster);
        container.appendChild(div);
    });
    
    // Render other relations
    otherRelations.forEach(rel => {
        const div = createRelationCard(rel);
        container.appendChild(div);
    });
    
    renderPagination(data.total_pages);
}

function buildSynonymClusters(synonyms) {
    if (synonyms.length === 0) return [];
    
    // Build adjacency map
    const graph = new Map();
    const relationsMap = new Map(); // Store original relation data
    
    synonyms.forEach(rel => {
        if (!graph.has(rel.tag1)) graph.set(rel.tag1, new Set());
        if (!graph.has(rel.tag2)) graph.set(rel.tag2, new Set());
        
        graph.get(rel.tag1).add(rel.tag2);
        if (rel.bidirectional) {
            graph.get(rel.tag2).add(rel.tag1);
        }
        
        // Store relation data for later
        const key = `${rel.tag1}|${rel.tag2}`;
        relationsMap.set(key, rel);
    });
    
    // Find connected components (synonym groups)
    const visited = new Set();
    const clusters = [];
    
    function dfs(tag, cluster) {
        if (visited.has(tag)) return;
        visited.add(tag);
        cluster.add(tag);
        
        if (graph.has(tag)) {
            for (const neighbor of graph.get(tag)) {
                dfs(neighbor, cluster);
            }
        }
    }
    
    // Find all clusters
    for (const tag of graph.keys()) {
        if (!visited.has(tag)) {
            const cluster = new Set();
            dfs(tag, cluster);
            if (cluster.size > 1) {
                clusters.push({
                    tags: Array.from(cluster).sort(),
                    relations: synonyms.filter(r => 
                        cluster.has(r.tag1) && cluster.has(r.tag2)
                    )
                });
            }
        }
    }
    
    return clusters;
}

function createSynonymClusterCard(cluster) {
    const div = document.createElement("div");
    div.className = "relation-item synonym synonym-cluster";
    
    // Icon
    const icon = document.createElement("span");
    icon.className = "relation-icon synonym";
    icon.innerHTML = "⇄";
    icon.title = "Synonym Group";
    
    // Content
    const contentDiv = document.createElement("div");
    contentDiv.className = "relation-content";
    
    // Tags display
    const tags = document.createElement("div");
    tags.className = "relation-tags synonym-cluster-tags";
    
    const tagElements = cluster.tags.map(tag => {
        // Find count from any relation containing this tag
        const rel = cluster.relations.find(r => r.tag1 === tag || r.tag2 === tag);
        const count = rel ? (rel.tag1 === tag ? rel.tag1_current_count : rel.tag2_current_count) : 0;
        return `<span class="cluster-tag"><strong>${tag}</strong> (${count})</span>`;
    });
    
    tags.innerHTML = tagElements.join(' <span class="cluster-separator">≈</span> ');
    
    // Cluster info
    const info = document.createElement("div");
    info.className = "cluster-info";
    info.textContent = `${cluster.tags.length} synonymous tags, ${cluster.relations.length} relations`;
    
    // Expand button
    const expandBtn = document.createElement("button");
    expandBtn.className = "show-more-btn";
    expandBtn.textContent = "Show Details";
    expandBtn.onclick = () => toggleClusterDetails(cluster, expandBtn);
    
    // Details container
    const detailsDiv = document.createElement("div");
    detailsDiv.className = "cluster-details";
    detailsDiv.style.display = "none";
    detailsDiv.dataset.clusterId = cluster.tags.join('_');
    
    contentDiv.appendChild(tags);
    contentDiv.appendChild(info);
    contentDiv.appendChild(expandBtn);
    contentDiv.appendChild(detailsDiv);
    
    // Actions
    const actions = document.createElement("div");
    actions.className = "relation-actions";
    
    const manageBtn = document.createElement("button");
    manageBtn.className = "type-btn";
    manageBtn.textContent = "✎";
    manageBtn.title = "Manage cluster";
    manageBtn.onclick = () => showClusterManageModal(cluster);
    
    actions.appendChild(manageBtn);
    
    div.appendChild(icon);
    div.appendChild(contentDiv);
    div.appendChild(actions);
    
    return div;
}

function toggleClusterDetails(cluster, btn) {
    const detailsDiv = document.querySelector(`[data-cluster-id="${cluster.tags.join('_')}"]`);
    
    if (detailsDiv.style.display === "none") {
        // Show details
        detailsDiv.innerHTML = "";
        
        cluster.relations.forEach(rel => {
            const relDiv = document.createElement("div");
            relDiv.className = "cluster-relation-item";
            
            const direction = rel.bidirectional ? "↔" : "→";
            relDiv.innerHTML = `
                <span><strong>${rel.tag1}</strong> ${direction} <strong>${rel.tag2}</strong></span>
                <button class="delete-mini-btn" onclick="deleteRelation(${rel.id})" title="Delete this relation">×</button>
            `;
            
            detailsDiv.appendChild(relDiv);
        });
        
        detailsDiv.style.display = "block";
        btn.textContent = "Hide Details";
    } else {
        detailsDiv.style.display = "none";
        btn.textContent = "Show Details";
    }
}

function showClusterManageModal(cluster) {
    const modal = document.getElementById("cluster_manage_modal");
    if (!modal) {
        // Create modal if it doesn't exist
        createClusterManageModal();
        return showClusterManageModal(cluster);
    }
    
    const tagList = document.getElementById("cluster_tag_list");
    tagList.innerHTML = "";
    
    cluster.tags.forEach(tag => {
        const item = document.createElement("div");
        item.className = "cluster-manage-item";
        item.innerHTML = `
            <span><strong>${tag}</strong></span>
            <button class="deny-btn" onclick="removeTagFromCluster('${tag}', ${JSON.stringify(cluster.tags)})">Remove</button>
        `;
        tagList.appendChild(item);
    });
    
    modal.style.display = "flex";
    modal.dataset.cluster = JSON.stringify(cluster);
}

function closeClusterManageModal() {
    const modal = document.getElementById("cluster_manage_modal");
    if (modal) modal.style.display = "none";
}

function removeTagFromCluster(tagToRemove, clusterTags) {
    if (!confirm(`Remove "${tagToRemove}" from this synonym group? This will delete all relations involving this tag.`)) {
        return;
    }
    
    // Find and delete all relations involving this tag in the cluster
    const relationsToDelete = relationsCache.relations.filter(r => 
        r.relation_type === 'synonym' && 
        clusterTags.includes(r.tag1) && 
        clusterTags.includes(r.tag2) &&
        (r.tag1 === tagToRemove || r.tag2 === tagToRemove)
    );
    
    let deletePromises = relationsToDelete.map(rel => 
        fetch("/delete_relation", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({id: rel.id})
        })
    );
    
    Promise.all(deletePromises).then(() => {
        closeClusterManageModal();
        relationsCache = null; // Invalidate cache
        loadConfirmedRelations(currentPage, true);
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
            calcDiv.innerHTML = `
                <div class="calc-info">
                    <div><strong>${data.tag1}:</strong> ${data.tag1_count.toLocaleString()} objects</div>
                    <div><strong>${data.tag2}:</strong> ${data.tag2_count.toLocaleString()} objects</div>
                    <div><strong>Co-occur:</strong> ${data.cooccurrence.toLocaleString()} objects</div>
                    <div><strong>Overlap:</strong> ${data.overlap_percentage}% of smaller set</div>
                </div>
                <div class="venn-chart">
                    <svg viewBox="0 0 300 150" width="300" height="150">
                        <!-- Tag1 circle -->
                        <circle cx="100" cy="75" r="50" fill="rgba(76, 175, 80, 0.2)" stroke="#4CAF50" stroke-width="2"/>
                        <!-- Tag2 circle -->
                        <circle cx="200" cy="75" r="50" fill="rgba(33, 150, 243, 0.2)" stroke="#2196F3" stroke-width="2"/>
                        
                        <!-- Labels -->
                        <text x="75" y="40" font-size="12" font-weight="bold" fill="#2e7d32">${data.tag1}</text>
                        <text x="200" y="40" font-size="12" font-weight="bold" fill="#1565c0" text-anchor="middle">${data.tag2}</text>
                        
                        <!-- Counts -->
                        <text x="75" y="75" font-size="14" font-weight="bold" text-anchor="middle" fill="#333">${data.tag1_only.toLocaleString()}</text>
                        <text x="150" y="75" font-size="16" font-weight="bold" text-anchor="middle" fill="#d84315">${data.cooccurrence.toLocaleString()}</text>
                        <text x="225" y="75" font-size="14" font-weight="bold" text-anchor="middle" fill="#333">${data.tag2_only.toLocaleString()}</text>
                        
                        <!-- Bottom labels -->
                        <text x="75" y="130" font-size="10" text-anchor="middle" fill="#666">only ${data.tag1}</text>
                        <text x="150" y="130" font-size="10" text-anchor="middle" fill="#666">both</text>
                        <text x="225" y="130" font-size="10" text-anchor="middle" fill="#666">only ${data.tag2}</text>
                    </svg>
                </div>
            `;
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
    relationsCache = null; // Invalidate cache
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
    let contextTags = '';
    
    if (input.includes('=/=')) {
        [tag1, tag2] = input.split('=/=').map(t => t.trim());
        relationType = 'antonym';
        
        // For antonyms, extract context if tag1 has multiple parts
        const tag1Parts = tag1.split(/\s+/);
        if (tag1Parts.length > 1) {
            contextTags = tag1Parts[0];
            tag1 = tag1Parts.slice(1).join(' ');
        }
    } else if (input.includes('=')) {
        [tag1, tag2] = input.split('=').map(t => t.trim());
        relationType = 'synonym';
    } else {
        const parts = input.split(/\s+/);
        if (parts.length < 2) {
            alert("Invalid format. Use: 'tag1 tag2' or 'tag1=tag2' or 'tag1=/=tag2'");
            return;
        }
        
        // For space-separated, assume last is tag2, rest is tag1
        tag2 = parts[parts.length - 1];
        tag1 = parts.slice(0, -1).join(' ');
        
        // If tag1 has multiple parts, treat first part as context for antonym
        if (parts.length > 2) {
            relationType = 'antonym';
            contextTags = parts[0];
            tag1 = parts.slice(1, -1).join(' ');
        }
    }
    
    if (!tag1 || !tag2) {
        alert("Both tags must be specified");
        return;
    }
    
    // Fetch actual tag counts from backend
    fetch("/suggest", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({tags: [tag1, tag2], top_n: 1})
    })
    .then(r => r.json())
    .then(data => {
        // Use tag counts from suggestion engine (more reliable)
        // Default to 0 if not found
        const tag1Count = 0; // Will be fetched from backend in next iteration
        const tag2Count = 0;
        
        // For now, make a simpler fetch to get counts
        return fetch("/get_tag_counts", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({tags: [tag1, tag2]})
        });
    })
    .then(r => r.json())
    .then(counts => {
        const suggestion = {
            tag1: tag1,
            tag2: tag2,
            tag1_count: counts[tag1] || 0,
            tag2_count: counts[tag2] || 0,
            relation_type: relationType,
            confidence: 100,
            context_tags: contextTags,
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
    })
    .catch(err => {
        // Fallback if backend doesn't have counts endpoint yet
        const suggestion = {
            tag1: tag1,
            tag2: tag2,
            tag1_count: 0,
            tag2_count: 0,
            relation_type: relationType,
            confidence: 100,
            context_tags: contextTags,
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
    });
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
    
    // Load confirmed relations immediately
    loadConfirmedRelations(1);
    
    // Check if suggestions should preload
    loadPerformanceSettings().then(settings => {
        if (settings.preload_suggestions_on_page_load) {
            loadDynamicSuggestions('both');
        } else {
            // Show placeholder message
            document.getElementById('synonym_suggestions_container').innerHTML = 
                '<em>Click "Load Suggestions" to generate synonym suggestions</em>';
            document.getElementById('antonym_suggestions_container').innerHTML = 
                '<em>Click "Load Suggestions" to generate antonym suggestions</em>';
        }
    });
};


async function loadPerformanceSettings() {
    try {
        const response = await fetch('/get_performance_settings');
        return await response.json();
    } catch (err) {
        console.error('Error loading settings:', err);
        return {};
    }
}

function showSettingsModal() {
    loadPerformanceSettings().then(settings => {
        document.getElementById('setting_max_tags').value = settings.max_tags_to_analyze || 800;
        document.getElementById('setting_min_freq_syn').value = settings.min_tag_frequency_synonym || 10;
        document.getElementById('setting_min_freq_ant').value = settings.min_tag_frequency_antonym || 50;
        document.getElementById('setting_parallel').checked = settings.enable_parallel_processing !== false;
        document.getElementById('setting_workers').value = settings.num_worker_processes || 0;
        document.getElementById('setting_skip_sparse').checked = settings.skip_sparse_objects !== false;
        document.getElementById('setting_min_tags_obj').value = settings.min_tags_per_object || 3;
        document.getElementById('setting_cache_duration').value = settings.suggestion_cache_duration || 30;
        document.getElementById('setting_preload').checked = settings.preload_suggestions_on_page_load || false;
        
        // Show/hide min tags input based on skip sparse checkbox
        updateMinTagsVisibility();
        
        document.getElementById('settings_modal').style.display = 'flex';
    });
}

function closeSettingsModal() {
    document.getElementById('settings_modal').style.display = 'none';
}

function updateMinTagsVisibility() {
    const skipSparse = document.getElementById('setting_skip_sparse').checked;
    const container = document.getElementById('min_tags_container');
    container.style.display = skipSparse ? 'block' : 'none';
}

// Add listener to skip_sparse checkbox
document.addEventListener('DOMContentLoaded', () => {
    const skipSparseCheckbox = document.getElementById('setting_skip_sparse');
    if (skipSparseCheckbox) {
        skipSparseCheckbox.addEventListener('change', updateMinTagsVisibility);
    }
});

function saveSettings() {
    const settings = {
        max_tags_to_analyze: parseInt(document.getElementById('setting_max_tags').value),
        min_tag_frequency_synonym: parseInt(document.getElementById('setting_min_freq_syn').value),
        min_tag_frequency_antonym: parseInt(document.getElementById('setting_min_freq_ant').value),
        enable_parallel_processing: document.getElementById('setting_parallel').checked,
        num_worker_processes: parseInt(document.getElementById('setting_workers').value) || null,
        skip_sparse_objects: document.getElementById('setting_skip_sparse').checked,
        min_tags_per_object: parseInt(document.getElementById('setting_min_tags_obj').value),
        suggestion_cache_duration: parseInt(document.getElementById('setting_cache_duration').value),
        preload_suggestions_on_page_load: document.getElementById('setting_preload').checked,
    };
    
    fetch('/update_performance_settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(settings)
    })
    .then(r => r.json())
    .then(data => {
        alert('Settings saved! Changes will take effect on next suggestion generation.');
        closeSettingsModal();
        
        // Clear any loaded suggestions so they regenerate with new settings
        synonymOffset = 0;
        antonymOffset = 0;
        preloadedSynonyms = [];
        preloadedAntonyms = [];
        processedSuggestions.clear();
    })
    .catch(err => {
        alert('Error saving settings: ' + err);
    });
}

function resetSettings() {
    if (!confirm('Reset all settings to defaults?')) return;
    
    fetch('/reset_performance_settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'}
    })
    .then(r => r.json())
    .then(data => {
        alert('Settings reset to defaults!');
        showSettingsModal(); // Reload modal with default values
    })
    .catch(err => {
        alert('Error resetting settings: ' + err);
    });
}