# ==========================================
# FILE: relation_analyzer.py
# ==========================================
from database import get_unrelated_pairs, get_relation
from config import RELATIONS_DB
import sqlite3
from collections import defaultdict
from itertools import combinations

class RelationAnalyzer:
    def __init__(self, tag_counts, tag_to_objects):
        self.tag_counts = tag_counts
        self.tag_to_objects = tag_to_objects
        self.total_objects = len(set().union(*tag_to_objects.values())) if tag_to_objects else 0
        self._seen_suggestions = set()  # Track what we've already suggested
    
    def calculate_suggested_relations(self, limit=5, offset=0, relation_type=None, force_tag=None):
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
        """Calculate synonym suggestions - ONLY single tags"""
        suggestions = []
        
        for tag1 in tags_list:
            if force_tag and tag1 != force_tag:
                continue
            
            # CRITICAL: Skip if tag1 contains spaces (multi-tag)
            if ' ' in tag1:
                continue
                
            tag1_count = self.tag_counts[tag1]
            tag1_objs = self.tag_to_objects[tag1]
            
            for tag2 in self.tag_counts:
                # Skip multi-tag combinations for synonyms
                if ' ' in tag1 or ' ' in tag2:
                    continue
                if tag1 >= tag2:
                    continue
                
                # CRITICAL: Skip if tag2 contains spaces (multi-tag)
                if ' ' in tag2:
                    continue
                
                # Check if already exists
                if (tag1, tag2, "") in existing_relations:
                    continue
                if (tag1, tag2) in unrelated or (tag2, tag1) in unrelated:
                    continue
                
                tag2_count = self.tag_counts[tag2]
                tag2_objs = self.tag_to_objects[tag2]
                
                # Skip very rare tags
                if tag1_count < 10 or tag2_count < 10:
                    continue
                
                cooccur = len(tag1_objs & tag2_objs)
                
                # Enhanced synonym heuristic
                min_count = min(tag1_count, tag2_count)
                max_count = max(tag1_count, tag2_count)
                
                cooccur_rate = cooccur / min_count
                freq_ratio = min_count / max_count
                
                # Perfect subset = 100% confidence
                if cooccur == min_count and cooccur == max_count:
                    confidence = 1.0
                    suggested_direction = "bidirectional"
                elif cooccur == min_count:  # Smaller tag is subset of larger
                    confidence = 1.0
                    suggested_direction = "one_way"
                elif cooccur_rate > 0.7 and freq_ratio > 0.4:
                    # High co-occurrence
                    occurrence_weight = min(1.0, (min_count / 1000) ** 0.5)
                    confidence = cooccur_rate * freq_ratio * occurrence_weight
                    
                    # Suggest bidirectional if very similar
                    if cooccur_rate > 0.9 and freq_ratio > 0.8:
                        suggested_direction = "bidirectional"
                    else:
                        suggested_direction = "one_way"
                else:
                    continue
                
                # Order: smaller count first for one-way
                if tag1_count < tag2_count:
                    first_tag, second_tag = tag1, tag2
                    first_count, second_count = tag1_count, tag2_count
                else:
                    first_tag, second_tag = tag2, tag1
                    first_count, second_count = tag2_count, tag1_count
                
                suggestions.append({
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
                })
        
        return suggestions
    
    def _calculate_antonyms(self, tags_list, unrelated, existing_relations, force_tag=None):
        """Calculate antonym suggestions including contextual antonyms"""
        suggestions = []
        
        # Build tag context map
        tag_contexts = self._build_tag_contexts()
        
        # Single tag antonyms
        for tag1 in tags_list:
            if force_tag and tag1 != force_tag:
                continue
            
            # Skip multi-tag for single antonyms
            if ' ' in tag1:
                continue
                
            tag1_count = self.tag_counts[tag1]
            tag1_objs = self.tag_to_objects[tag1]
            
            if tag1_count < 50:
                continue
            
            for tag2 in self.tag_counts:
                if tag1 >= tag2:
                    continue
                
                # Skip multi-tag for single antonyms
                if ' ' in tag2:
                    continue
                
                if (tag1, tag2, "") in existing_relations:
                    continue
                if (tag1, tag2) in unrelated or (tag2, tag1) in unrelated:
                    continue
                
                tag2_count = self.tag_counts[tag2]
                tag2_objs = self.tag_to_objects[tag2]
                
                if tag2_count < 50:
                    continue
                
                cooccur = len(tag1_objs & tag2_objs)
                min_count = min(tag1_count, tag2_count)
                max_count = max(tag1_count, tag2_count)
                
                cooccur_rate = cooccur / min_count
                freq_ratio = min_count / max_count
                
                # Calculate context similarity
                context_similarity = self._calculate_context_similarity(tag1, tag2, tag_contexts)
                
                # Enhanced antonym heuristic
                occurrence_weight = min(1.0, (min_count / 1000) ** 0.3)
                dataset_coverage = (tag1_count + tag2_count) / (2 * self.total_objects)
                
                # Relaxed thresholds to find more antonyms
                if (cooccur_rate < 0.08 and
                    freq_ratio > 0.25 and
                    context_similarity > 0.35 and
                    dataset_coverage > 0.008):
                    
                    confidence = (1 - cooccur_rate) * freq_ratio * context_similarity * occurrence_weight * 0.7
                    
                    suggestions.append({
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
                    })
        
        # Contextual antonyms (ONLY for very common tags - min 200 occurrences)
        contextual_antonyms = self._find_contextual_antonyms(tags_list, existing_relations, force_tag)
        suggestions.extend(contextual_antonyms)
        
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
        """Build a map of tag -> commonly co-occurring tags"""
        tag_contexts = defaultdict(lambda: defaultdict(int))
        
        # Build reverse mapping
        obj_to_tags = defaultdict(set)
        for tag, obj_set in self.tag_to_objects.items():
            for obj_idx in list(obj_set)[:5000]:  # Sample for performance
                obj_to_tags[obj_idx].add(tag)
        
        # Count co-occurrences
        for obj_idx, tags in obj_to_tags.items():
            tags_list = list(tags)
            for i, tag1 in enumerate(tags_list):
                for tag2 in tags_list[i+1:]:
                    tag_contexts[tag1][tag2] += 1
                    tag_contexts[tag2][tag1] += 1
        
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