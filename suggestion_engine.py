
# ==========================================
# FILE: suggestion_engine.py
# ==========================================
import math
from collections import Counter
from config import (ALPHA, BETA, GAMMA, MIN_TAG_OCCURRENCES, 
                   STRONG_CORRELATION_THRESHOLD, SYNONYM_BOOST_SCORE, 
                   STRONG_CORRELATION_BOOST)
from database import get_confirmed_synonyms, get_confirmed_antonyms

class SuggestionEngine:
    def __init__(self, tag_lists, tag_counts, tag_to_objects, total_objects):
        self.tag_lists = tag_lists
        self.tag_counts = tag_counts
        self.tag_to_objects = tag_to_objects
        self.total_objects = total_objects
        self.tag_rarity = {
            tag: math.log((total_objects + 1)/(count + 1)) 
            for tag, count in tag_counts.items()
        }
    
    def is_antonym_pair(self, candidate, input_tags, confirmed_antonyms):
        """Check if candidate is an antonym of any input tag"""
        for input_tag in input_tags:
            # Check direct antonym
            if (candidate, input_tag, "") in confirmed_antonyms:
                return True
            # Check context-specific antonyms
            for tag1, tag2, context in confirmed_antonyms:
                if candidate == tag1 and input_tag == tag2:
                    if not context:
                        return True
                    # Check if context tags are present
                    context_list = context.split()
                    if all(ct in input_tags for ct in context_list):
                        return True
        return False
    
    def calculate_suggestions(self, input_tags, top_n=10, offset=0):
        """Calculate tag suggestions based on input tags"""
        if not input_tags:
            return {"matched_documents": 0, "suggestions": [], "has_more": False}
        
        # Load confirmed relations
        confirmed_synonyms = get_confirmed_synonyms()
        confirmed_antonyms = get_confirmed_antonyms()
        
        # Ignore incomplete last tag
        last_tag = input_tags[-1]
        if last_tag not in self.tag_to_objects or len(self.tag_to_objects[last_tag]) == 0:
            input_tags = input_tags[:-1]
        
        candidate_tags = set(self.tag_counts.keys()) - set(input_tags)
        suggestions = []
        synonym_boost_tags = []
        
        # Boost confirmed synonyms to top
        for input_tag in input_tags:
            if input_tag in confirmed_synonyms:
                for syn in confirmed_synonyms[input_tag]:
                    if syn not in input_tags:
                        synonym_boost_tags.append(syn)
        
        for candidate in candidate_tags:
            # HARD FILTER: Skip confirmed antonyms
            if self.is_antonym_pair(candidate, input_tags, confirmed_antonyms):
                continue
            
            # Skip very rare tags (< MIN_TAG_OCCURRENCES) unless they're synonyms
            candidate_count = self.tag_counts.get(candidate, 0)
            if candidate_count < MIN_TAG_OCCURRENCES and candidate not in synonym_boost_tags:
                continue
            
            cooccurrence_score = 0
            for obj_idx in self.tag_to_objects.get(candidate, set()):
                obj_tags = set(self.tag_lists[obj_idx])
                cooccurrence_score += len(obj_tags & set(input_tags))
            
            rarity_score = self.tag_rarity.get(candidate, 0)
            
            # Enhanced contradiction penalty
            contradiction_penalty = 0.0
            for t in input_tags:
                candidate_objects = self.tag_to_objects.get(candidate, set())
                input_objects = self.tag_to_objects.get(t, set())
                
                if not input_objects or not candidate_objects:
                    continue
                
                cooccur_count = len(candidate_objects & input_objects)
                rate = cooccur_count / max(1, len(input_objects))
                
                # Reduced penalty for rare tags
                if candidate_count >= 50:
                    contradiction_penalty += 1 - rate
                else:
                    contradiction_penalty += (1 - rate) * (candidate_count / 50)
            
            cooccurrence_norm = cooccurrence_score / max(1, len(input_tags))
            rarity_boosted = rarity_score * (1 + math.log1p(rarity_score))
            
            # Check for strong correlation (99%+ co-occurrence)
            strongly_correlated = False
            max_correlation = 0.0
            for t in input_tags:
                candidate_objs = self.tag_to_objects.get(candidate, set())
                t_objs = self.tag_to_objects.get(t, set())
                if t_objs:
                    cooccur_ratio = len(candidate_objs & t_objs) / len(t_objs)
                    max_correlation = max(max_correlation, cooccur_ratio)
                    if cooccur_ratio >= STRONG_CORRELATION_THRESHOLD:
                        strongly_correlated = True
                        break
            
            # Base score
            score = ALPHA * cooccurrence_norm + BETA * rarity_boosted - GAMMA * contradiction_penalty
            
            # Massive boost for strong correlation (likely synonyms)
            if strongly_correlated:
                score = STRONG_CORRELATION_BOOST + max_correlation
            
            # Even bigger boost for confirmed synonyms
            if candidate in synonym_boost_tags:
                score = SYNONYM_BOOST_SCORE
            
            suggestions.append({
                "tag": candidate,
                "score": round(score, 4),
                "probability": round(score, 4),
                "similarity": 0.0,
                "rarity": round(rarity_boosted, 4),
                "cooccurrence": round(cooccurrence_norm, 4),
                "penalty": round(contradiction_penalty, 4),
                "is_synonym": candidate in synonym_boost_tags
            })
        
        suggestions.sort(key=lambda x: x["score"], reverse=True)
        paginated = suggestions[offset : offset + top_n]
        
        return {
            "matched_documents": self.total_objects,
            "suggestions": paginated,
            "has_more": (offset + top_n) < len(suggestions)
        }
