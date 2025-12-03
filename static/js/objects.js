let currentSearch = new URLSearchParams(window.location.search).get("search") || "";
let currentPage = 1;
let duplicateIds = [];

document.getElementById("search_bar").value = currentSearch;

function loadObjects(page = 1) {
    currentPage = page;
    const searchText = document.getElementById("search_bar").value.trim();
    currentSearch = searchText;

    fetch(`/fetch_objects?page=${page}&search=${encodeURIComponent(searchText)}`)
    .then(r => r.json())
    .then(data => {
        const container = document.getElementById("objects_container");
        container.innerHTML = "";
        if (data.objects.length === 0) {
            container.innerHTML = "<em>No objects found.</em>";
            document.getElementById("pagination").innerHTML = "";
            return;
        }

        data.objects.forEach(obj => {
            const div = document.createElement("div");
            div.className = "object-card";
            div.innerHTML = `<strong>ID:</strong> ${obj.id}<br><strong>Tags:</strong> ${obj.tags.join(" ")}
                <br><button class="delete-btn" onclick="deleteObject('${obj.id}')">Delete</button>`;
            container.appendChild(div);
        });

        // Pagination
        const pag = document.getElementById("pagination");
        pag.innerHTML = "";
        const totalPages = data.total_pages;
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, currentPage + 2);

        if (startPage > 1) {
            const firstBtn = document.createElement("button");
            firstBtn.innerText = "1";
            firstBtn.className = "page-btn";
            firstBtn.onclick = () => loadObjects(1);
            pag.appendChild(firstBtn);
            if (startPage > 2) {
                pag.insertAdjacentHTML('beforeend', '<span>...</span>');
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            const btn = document.createElement("button");
            btn.innerText = i;
            btn.className = "page-btn";
            if (i === currentPage) btn.disabled = true;
            btn.onclick = () => loadObjects(i);
            pag.appendChild(btn);
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                pag.insertAdjacentHTML('beforeend', '<span>...</span>');
            }
            const lastBtn = document.createElement("button");
            lastBtn.innerText = totalPages;
            lastBtn.className = "page-btn";
            lastBtn.onclick = () => loadObjects(totalPages);
            pag.appendChild(lastBtn);
        }
    });
}

function deleteObject(id) {
    if (!confirm("Delete object " + id + "?")) return;
    fetch("/delete_object", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({id: id})
    }).then(() => {
        loadObjects(currentPage);
        loadTotalObjects();
    });
}

function loadTotalObjects() {
    fetch("/count_objects")
        .then(r => r.json())
        .then(data => {
            document.getElementById("total_objects").innerText = data.total;
        });
}

function previewDuplicates() {
    fetch("/preview_duplicates")
    .then(r => r.json())
    .then(data => {
        let container = document.getElementById("duplicate_preview");
        duplicateIds = [];
        if (data.length === 0) {
            container.innerHTML = "<em>No duplicates found.</em>";
            document.getElementById("confirm_delete_btn").style.display = "none";
            return;
        }
        let html = "<div>";
        data.forEach(item => {
            html += `<div class="duplicate-item"><strong>Tags:</strong> ${item.tags.join(" ")}<br>
                     <strong>Duplicate IDs:</strong> ${item.duplicate_ids.join(", ")}</div>`;
            duplicateIds.push(...item.duplicate_ids);
        });
        html += "</div>";
        container.innerHTML = html;
        document.getElementById("confirm_delete_btn").style.display = "inline-block";
    });
}

function deleteDuplicates() {
    if (!confirm("Delete all " + duplicateIds.length + " duplicate objects?")) return;
    fetch("/delete_duplicates", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ids: duplicateIds})
    }).then(() => {
        document.getElementById("duplicate_preview").innerHTML = "<em>Duplicates deleted successfully.</em>";
        document.getElementById("confirm_delete_btn").style.display = "none";
        loadObjects(currentPage);
        loadTotalObjects();
    });
}

window.onload = () => {
    loadTotalObjects();
    loadObjects(1);
};