# ==========================================
# FILE: relation_analyzer.py
# ==========================================
from database import get_unrelated_pairs, get_relation
from config import RELATIONS_DB
import sqlite3
from collections import defaultdict
from itertools import combinations
from multiprocessing import Pool, cpu_count
from functools import partial
import time

class RelationAnalyzer:
    def __init__(self, tag_counts, tag_to_objects):
        self.tag_counts = tag_counts
        self.tag_to_objects = tag_to_objects
        self.total_objects = len(set().union(*tag_to_objects.values())) if tag_to_objects else 0
        self._seen_suggestions = set()  # Track what we've already suggested
    
    def calculate_suggested_relations(self, limit=5, offset=0, relation_type=None, force_tag=None):
        from config import PERF_SETTINGS
        cache_duration = PERF_SETTINGS.get('suggestion_cache_duration', 30)
        
        # Cache results for common queries
        cache_key = f"{limit}_{offset}_{relation_type}_{force_tag}"
        if hasattr(self, '_suggestion_cache') and cache_key in self._suggestion_cache:
            cached_time, cached_results = self._suggestion_cache[cache_key]
            from datetime import datetime
            if (datetime.now() - cached_time).total_seconds() < cache_duration:
                print(f"[PERF] Using cached results for query: {cache_key}")
                return cached_results[offset:offset + limit]
        
        if not hasattr(self, '_suggestion_cache'):
            self._suggestion_cache = {}
        """
        Calculate likely synonym/antonym pairs with enhanced heuristics
        relation_type: 'synonym', 'antonym', or None for all
        force_tag: if provided, only find relations involving this tag
        """
        suggestions = []
        unrelated = get_unrelated_pairs()
        existing_relations = self._get_existing_relations()
        
        # Limit search space but prioritize high-occurrence tags
        tags_list = sorted(self.tag_counts.keys(), key=lambda t: self.tag_counts[t], reverse=True)[:1000]
        
        if force_tag:
            force_tag = force_tag.lower()
            if force_tag not in self.tag_counts:
                return []
            tags_list = [force_tag] if force_tag in tags_list else [force_tag] + tags_list[:999]
        
        # Calculate synonyms (NEVER multi-tag)
        if relation_type is None or relation_type == 'synonym':
            synonym_suggestions = self._calculate_synonyms(tags_list, unrelated, existing_relations, force_tag)
            suggestions.extend(synonym_suggestions)
        
        # Calculate antonyms (including contextual, only for very common tags)
        if relation_type is None or relation_type == 'antonym':
            antonym_suggestions = self._calculate_antonyms(tags_list, unrelated, existing_relations, force_tag)
            suggestions.extend(antonym_suggestions)
        
        # Remove duplicates we've already seen in this session
        suggestions = [s for s in suggestions if self._make_suggestion_key(s) not in self._seen_suggestions]
        
        # Sort by confidence and occurrence weight
        suggestions.sort(key=lambda x: (x["confidence"], min(x["tag1_count"], x["tag2_count"])), reverse=True)
        
        # Mark suggestions as seen
        for s in suggestions[offset:offset + limit]:
            self._seen_suggestions.add(self._make_suggestion_key(s))
        
        # Store in cache
        from datetime import datetime
        self._suggestion_cache[cache_key] = (datetime.now(), suggestions)
        
        # Limit cache size
        if len(self._suggestion_cache) > 20:
            oldest_keys = sorted(self._suggestion_cache.keys(), 
                               key=lambda k: self._suggestion_cache[k][0])[:10]
            for k in oldest_keys:
                del self._suggestion_cache[k]
        
        # Apply offset and limit
        return suggestions[offset:offset + limit]
    
    def _make_suggestion_key(self, suggestion):
        """Create unique key for suggestion to prevent repeats"""
        return (suggestion['tag1'], suggestion['tag2'], suggestion['context_tags'], suggestion['relation_type'])
    
    def _get_existing_relations(self):
        """Get all existing relations to avoid duplicates"""
        existing = set()
        conn = sqlite3.connect(RELATIONS_DB, timeout=10.0)
        try:
            c = conn.cursor()
            c.execute("SELECT tag1, tag2, context_tags FROM tag_relations")
            for row in c.fetchall():
                # Store both single tags and normalized multi-tag forms
                tag1 = row[0]
                tag2 = row[1]
                context = row[2] or ""
                existing.add((tag1, tag2, context))
                existing.add((tag2, tag1, context))
        finally:
            conn.close()
        return existing
    
    def _calculate_synonyms(self, tags_list, unrelated, existing_relations, force_tag=None):
        """Calculate synonym suggestions - ONLY single tags - PARALLELIZED"""
        from config import PERF_SETTINGS
        
        min_freq = PERF_SETTINGS.get('min_tag_frequency_synonym', 10)
        max_analyze = PERF_SETTINGS.get('max_tags_to_analyze', 800)
        enable_parallel = PERF_SETTINGS.get('enable_parallel_processing', True)
        
        # Filter to single tags only
        single_tags = [t for t in tags_list if ' ' not in t and self.tag_counts[t] >= min_freq]
        
        if force_tag:
            force_tag = force_tag.lower()
            if force_tag not in single_tags:
                return []
            single_tags = [force_tag] + [t for t in single_tags if t != force_tag][:max_analyze-1]
        else:
            single_tags = single_tags[:max_analyze]
        
        # Generate pairs to check
        pairs_to_check = []
        for i, tag1 in enumerate(single_tags):
            for tag2 in single_tags[i+1:]:
                if (tag1, tag2, "") not in existing_relations:
                    if (tag1, tag2) not in unrelated and (tag2, tag1) not in unrelated:
                        pairs_to_check.append((tag1, tag2))
        
        if not enable_parallel:
            # Single-threaded fallback
            results = []
            for pair in pairs_to_check:
                result = _calculate_synonym_pair(pair, self.tag_counts, self.tag_to_objects)
                if result:
                    results.append(result)
            return results
        
        # Parallel processing
        num_workers = PERF_SETTINGS.get('num_worker_processes', None)
        if num_workers is None:
            num_workers = max(1, cpu_count() - 1)
        
        chunk_size = max(10, len(pairs_to_check) // (num_workers * 4))
        
        print(f"[PERF] Calculating {len(pairs_to_check)} synonym pairs using {num_workers} workers...")
        start_time = time.time()
        
        with Pool(processes=num_workers) as pool:
            worker_func = partial(
                _calculate_synonym_pair,
                tag_counts=self.tag_counts,
                tag_to_objects=self.tag_to_objects
            )
            results = pool.map(worker_func, pairs_to_check, chunksize=chunk_size)
        
        elapsed = time.time() - start_time
        print(f"[PERF] Synonym calculation completed in {elapsed:.2f}s")
        
        # Filter out None results
        suggestions = [r for r in results if r is not None]
        return suggestions
    
    def _calculate_antonyms(self, tags_list, unrelated, existing_relations, force_tag=None):
        """Calculate antonym suggestions - PARALLELIZED"""
        from config import PERF_SETTINGS
        
        min_freq = PERF_SETTINGS.get('min_tag_frequency_antonym', 50)
        max_analyze = PERF_SETTINGS.get('max_tags_to_analyze', 800)
        enable_parallel = PERF_SETTINGS.get('enable_parallel_processing', True)
        
        # Build tag context map once (expensive, so cache it)
        if not hasattr(self, '_tag_contexts_cache'):
            self._tag_contexts_cache = self._build_tag_contexts()
        tag_contexts = self._tag_contexts_cache
        
        # Filter to single tags only with minimum frequency
        single_tags = [t for t in tags_list if ' ' not in t and self.tag_counts[t] >= min_freq]
        
        if force_tag:
            force_tag = force_tag.lower()
            if force_tag in single_tags:
                single_tags = [force_tag] + [t for t in single_tags if t != force_tag][:max_analyze-1]
        else:
            single_tags = single_tags[:max_analyze]
        
        # Generate pairs
        pairs_to_check = []
        for i, tag1 in enumerate(single_tags):
            for tag2 in single_tags[i+1:]:
                if (tag1, tag2, "") not in existing_relations:
                    if (tag1, tag2) not in unrelated and (tag2, tag1) not in unrelated:
                        pairs_to_check.append((tag1, tag2))
        
        if not enable_parallel:
            # Single-threaded fallback
            results = []
            for pair in pairs_to_check:
                result = _calculate_antonym_pair(pair, self.tag_counts, self.tag_to_objects, 
                                               tag_contexts, self.total_objects)
                if result:
                    results.append(result)
            suggestions = results
        else:
            # Parallel processing
            num_workers = PERF_SETTINGS.get('num_worker_processes', None)
            if num_workers is None:
                num_workers = max(1, cpu_count() - 1)
            
            chunk_size = max(10, len(pairs_to_check) // (num_workers * 4))
            
            print(f"[PERF] Calculating {len(pairs_to_check)} antonym pairs using {num_workers} workers...")
            start_time = time.time()
            
            with Pool(processes=num_workers) as pool:
                worker_func = partial(
                    _calculate_antonym_pair,
                    tag_counts=self.tag_counts,
                    tag_to_objects=self.tag_to_objects,
                    tag_contexts=tag_contexts,
                    total_objects=self.total_objects
                )
                results = pool.map(worker_func, pairs_to_check, chunksize=chunk_size)
            
            elapsed = time.time() - start_time
            print(f"[PERF] Antonym calculation completed in {elapsed:.2f}s")
            
            suggestions = [r for r in results if r is not None]
        
        # Add contextual antonyms (still single-threaded as it's less common)
        contextual = self._find_contextual_antonyms(tags_list, existing_relations, force_tag)
        suggestions.extend(contextual)
        
        return suggestions
    
    def _find_contextual_antonyms(self, tags_list, existing_relations, force_tag=None):
        """Find pairs that are antonyms only in specific contexts - ONLY for very common tags"""
        suggestions = []
        
        # CRITICAL: Only use very high-frequency tags as contexts (min 200 occurrences)
        context_candidates = [t for t in tags_list if self.tag_counts[t] >= 1000 and ' ' not in t][:50]
        
        for context_tag in context_candidates:
            context_objs = self.tag_to_objects[context_tag]
            
            # Find tags that commonly appear with this context
            context_tags = {}
            for tag in tags_list:
                if tag == context_tag or ' ' in tag:  # Skip multi-tags
                    continue
                tag_objs = self.tag_to_objects[tag]
                overlap = len(tag_objs & context_objs)
                # CRITICAL: Require high minimum overlap (50)
                if overlap >= 50:
                    context_tags[tag] = (tag_objs & context_objs, overlap)
            
            # Look for pairs that don't co-occur within this context
            for tag1, (tag1_ctx_objs, tag1_overlap) in context_tags.items():
                if force_tag and tag1 != force_tag and context_tag != force_tag:
                    continue
                    
                for tag2, (tag2_ctx_objs, tag2_overlap) in context_tags.items():
                    if tag1 >= tag2:
                        continue
                    
                    # Check not already related
                    if (context_tag, tag1, tag2, "") in existing_relations or (context_tag, tag2, tag1, "") in existing_relations:
                        continue
                    
                    # Check if they co-occur in this context
                    ctx_cooccur = len(tag1_ctx_objs & tag2_ctx_objs)
                    min_ctx_count = min(tag1_overlap, tag2_overlap)
                    
                    # CRITICAL: Require substantial overlap (100+)
                    if min_ctx_count < 100:
                        continue
                    
                    ctx_cooccur_rate = ctx_cooccur / min_ctx_count
                    
                    # They should NOT co-occur in context but should appear separately
                    if ctx_cooccur_rate < 0.05 and tag1_overlap > 80 and tag2_overlap > 80:
                        confidence = (1 - ctx_cooccur_rate) * min(1.0, min_ctx_count / 150) * 0.5
                        
                        suggestions.append({
                            "tag1": f"{context_tag} {tag1}",
                            "tag2": tag2,
                            "tag1_count": tag1_overlap,
                            "tag2_count": tag2_overlap,
                            "relation_type": "antonym",
                            "confidence": round(confidence * 100, 1),
                            "context_tags": context_tag,
                            "cooccurrence": ctx_cooccur,
                            "calculation": f"Contextual: {ctx_cooccur}/{min_ctx_count} in '{context_tag}' context",
                            "suggested_direction": "none"
                        })
        
        return suggestions
    
    def _build_tag_contexts(self):
        """Build a map of tag -> commonly co-occurring tags - FULL PRECISION"""
        from config import PERF_SETTINGS
        
        print("[PERF] Building tag contexts (full precision)...")
        start_time = time.time()
        
        tag_contexts = defaultdict(lambda: defaultdict(int))
        
        # Build reverse mapping with optional sparse object filtering
        obj_to_tags = defaultdict(set)
        min_tags = PERF_SETTINGS.get('min_tags_per_object', 3) if PERF_SETTINGS.get('skip_sparse_objects', True) else 0
        
        processed_objects = 0
        skipped_objects = 0
        
        for tag, obj_set in self.tag_to_objects.items():
            for obj_idx in obj_set:
                obj_to_tags[obj_idx].add(tag)
        
        # Filter sparse objects if enabled
        if min_tags > 0:
            filtered_obj_to_tags = {obj_idx: tags for obj_idx, tags in obj_to_tags.items() 
                                   if len(tags) >= min_tags}
            skipped_objects = len(obj_to_tags) - len(filtered_obj_to_tags)
            obj_to_tags = filtered_obj_to_tags
        
        # Count co-occurrences - ALL objects (no sampling)
        for obj_idx, tags in obj_to_tags.items():
            tags_list = list(tags)
            for i, tag1 in enumerate(tags_list):
                for tag2 in tags_list[i+1:]:
                    tag_contexts[tag1][tag2] += 1
                    tag_contexts[tag2][tag1] += 1
            processed_objects += 1
            
            # Progress indicator for large datasets
            if processed_objects % 10000 == 0:
                print(f"[PERF] Processed {processed_objects:,} objects...")
        
        elapsed = time.time() - start_time
        print(f"[PERF] Tag contexts built in {elapsed:.2f}s ({processed_objects:,} objects processed, {skipped_objects:,} skipped)")
        
        return tag_contexts
    
    def _calculate_context_similarity(self, tag1, tag2, tag_contexts):
        """Calculate how similar the contexts of two tags are"""
        context1 = set(tag_contexts[tag1].keys())
        context2 = set(tag_contexts[tag2].keys())
        
        if not context1 or not context2:
            return 0.0
        
        intersection = len(context1 & context2)
        union = len(context1 | context2)
        
        return intersection / union if union > 0 else 0.0

def _calculate_synonym_pair(pair, tag_counts, tag_to_objects):
    """Worker function to calculate synonym score for a single pair"""
    tag1, tag2 = pair
    
    tag1_count = tag_counts.get(tag1, 0)
    tag2_count = tag_counts.get(tag2, 0)
    
    if tag1_count < 10 or tag2_count < 10:
        return None
    
    tag1_objs = tag_to_objects.get(tag1, set())
    tag2_objs = tag_to_objects.get(tag2, set())
    
    cooccur = len(tag1_objs & tag2_objs)
    min_count = min(tag1_count, tag2_count)
    max_count = max(tag1_count, tag2_count)
    
    cooccur_rate = cooccur / min_count if min_count > 0 else 0
    freq_ratio = min_count / max_count if max_count > 0 else 0
    
    # Determine confidence and direction
    if cooccur == min_count and cooccur == max_count:
        confidence = 1.0
        suggested_direction = "bidirectional"
    elif cooccur == min_count:
        confidence = 1.0
        suggested_direction = "one_way"
    elif cooccur_rate > 0.7 and freq_ratio > 0.4:
        occurrence_weight = min(1.0, (min_count / 1000) ** 0.5)
        confidence = cooccur_rate * freq_ratio * occurrence_weight
        suggested_direction = "bidirectional" if (cooccur_rate > 0.9 and freq_ratio > 0.8) else "one_way"
    else:
        return None
    
    # Order: smaller count first for one-way
    if tag1_count < tag2_count:
        first_tag, second_tag = tag1, tag2
        first_count, second_count = tag1_count, tag2_count
    else:
        first_tag, second_tag = tag2, tag1
        first_count, second_count = tag2_count, tag1_count
    
    return {
        "tag1": first_tag,
        "tag2": second_tag,
        "tag1_count": first_count,
        "tag2_count": second_count,
        "relation_type": "synonym",
        "confidence": round(confidence * 100, 1),
        "context_tags": "",
        "cooccurrence": cooccur,
        "calculation": f"Co-occur: {cooccur}/{min_count} ({cooccur_rate:.1%}), Freq ratio: {freq_ratio:.2f}",
        "suggested_direction": suggested_direction
    }
    
def _calculate_antonym_pair(pair, tag_counts, tag_to_objects, tag_contexts, total_objects):
    """Worker function to calculate antonym score for a single pair"""
    tag1, tag2 = pair
    
    tag1_count = tag_counts.get(tag1, 0)
    tag2_count = tag_counts.get(tag2, 0)
    
    if tag1_count < 50 or tag2_count < 50:
        return None
    
    tag1_objs = tag_to_objects.get(tag1, set())
    tag2_objs = tag_to_objects.get(tag2, set())
    
    cooccur = len(tag1_objs & tag2_objs)
    min_count = min(tag1_count, tag2_count)
    max_count = max(tag1_count, tag2_count)
    
    cooccur_rate = cooccur / min_count if min_count > 0 else 0
    freq_ratio = min_count / max_count if max_count > 0 else 0
    
    # Calculate context similarity
    context1 = set(tag_contexts.get(tag1, {}).keys()) if tag1 in tag_contexts else set()
    context2 = set(tag_contexts.get(tag2, {}).keys()) if tag2 in tag_contexts else set()
    
    if context1 and context2:
        intersection = len(context1 & context2)
        union = len(context1 | context2)
        context_similarity = intersection / union if union > 0 else 0
    else:
        context_similarity = 0
    
    # Antonym heuristic
    occurrence_weight = min(1.0, (min_count / 1000) ** 0.3)
    dataset_coverage = (tag1_count + tag2_count) / (2 * total_objects)
    
    if (cooccur_rate < 0.08 and
        freq_ratio > 0.25 and
        context_similarity > 0.35 and
        dataset_coverage > 0.008):
        
        confidence = (1 - cooccur_rate) * freq_ratio * context_similarity * occurrence_weight * 0.7
        
        return {
            "tag1": tag1 if tag1_count < tag2_count else tag2,
            "tag2": tag2 if tag1_count < tag2_count else tag1,
            "tag1_count": min(tag1_count, tag2_count),
            "tag2_count": max(tag1_count, tag2_count),
            "relation_type": "antonym",
            "confidence": round(confidence * 100, 1),
            "context_tags": "",
            "cooccurrence": cooccur,
            "calculation": f"Co-occur: {cooccur}/{min_count} ({cooccur_rate:.1%}), Context sim: {context_similarity:.2f}",
            "suggested_direction": "none"
        }
    
    return None