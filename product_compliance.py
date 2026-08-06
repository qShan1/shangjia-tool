"""Conservative pre-publish checks for marketplace product copy."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple


def _u(value: str) -> str:
    return value.encode("ascii").decode("unicode_escape")


REVIEW_PATTERNS: List[Tuple[str, str]] = [
    (r"\u7834\u89e3|\u76d7\u7248|\u7834\u89e3\u7248|\u6fc0\u6d3b\u7801|\u5e8f\u5217\u53f7|\u5916\u6302|\u811a\u672c\u6ce8\u5165", _u(r"\u68c0\u67e5\u5185\u5bb9\u6765\u6e90\u3001\u6388\u6743\u548c\u4ea4\u4ed8\u8303\u56f4")),
    (r"\u4ee3\u5145|\u5145\u503c|\u8fd4\u5229|\u5237\u5355|\u5237\u91cf|\u5957\u73b0|\u535a\u5f69|\u8d4c\u535a", _u(r"\u68c0\u67e5\u5b9e\u9645\u4ea4\u6613\u5185\u5bb9\u548c\u5e73\u53f0\u7c7b\u76ee")),
    (r"\u5171\u4eab\u8d26\u53f7|\u8d26\u53f7\u51fa\u79df|\u79df\u53f7|\u8d26\u53f7\u5bc6\u7801|\u4ee3\u767b\u5f55|\u63a5\u7ba1\u8d26\u53f7", _u(r"\u8bf7\u786e\u8ba4\u5546\u54c1\u8bf4\u660e\u548c\u4ea4\u4ed8\u8fb9\u754c")),
    (r"api\s*key|\u63a5\u53e3\u4ee3\u5f00|\u63a5\u53e3\u6ce8\u518c|\u6ce8\u518c\u5165\u53e3|\u6a21\u578b\u8c03\u7528|\u4ee3\u5f00|\u7b2c\u4e09\u65b9\u670d\u52a1", _u(r"\u8bf7\u5199\u6e05\u5b9e\u9645\u4ea4\u4ed8\u5185\u5bb9\u3001\u670d\u52a1\u65b9\u548c\u6709\u6548\u671f")),
    (r"\u514d\u5c01|\u7ed5\u8fc7\u98ce\u63a7|\u7ed5\u8fc7\u5ba1\u6838|\u89c4\u907f\u68c0\u6d4b|\u89e3\u5c01|\u5c01\u53f7\u6062\u590d", _u(r"\u8bf7\u786e\u8ba4\u5ba3\u79f0\u662f\u5426\u4e0e\u5b9e\u9645\u670d\u52a1\u4e00\u81f4")),
]

WARNING_PATTERNS: List[Tuple[str, str]] = [
    (r"\u52a0\u6211|\u8054\u7cfb\u6211|\u5fae\u4fe1|vx|v\u4fe1|qq|\u4e8c\u7ef4\u7801", _u(r"\u5305\u542b\u7ad9\u5916\u8054\u7cfb\u65b9\u5f0f\u6216\u5bfc\u6d41\u4fe1\u53f7")),
    (r"https?://|www\.|\.com/|\.cn/", _u(r"\u5305\u542b\u7ad9\u5916\u94fe\u63a5")),
    (r"\u5b98\u65b9\u6388\u6743|\u5b98\u65b9\u5408\u4f5c|\u6c38\u4e45\u6709\u6548|100%|\u7edd\u5bf9|\u4fdd\u8bc1|\u7a33\u8d5a|\u79d2\u53d1", _u(r"\u5305\u542b\u96be\u4ee5\u8bc1\u660e\u7684\u7edd\u5bf9\u5316\u6216\u6388\u6743\u8868\u8ff0")),
    (r"\u767e\u5ea6\u7f51\u76d8|\u7f51\u76d8\u94fe\u63a5|\u538b\u7f29\u5305|\u6e90\u7801|\u8bfe\u7a0b\u5168\u96c6|\u5168\u5957\u8d44\u6599", _u(r"\u865a\u62df\u8d44\u6599\u4ea4\u4ed8\u9700\u8981\u786e\u8ba4\u6765\u6e90\u3001\u6388\u6743\u548c\u5e73\u53f0\u7c7b\u76ee")),
]


def _find(patterns: List[Tuple[str, str]], text: str, severity: str) -> List[Dict[str, str]]:
    findings: List[Dict[str, str]] = []
    for pattern, message in patterns:
        match = re.search(_u(pattern), text, re.IGNORECASE)
        if match:
            findings.append({"severity": severity, "message": message, "evidence": match.group(0)})
    return findings


def check_product(payload: Dict[str, Any]) -> Dict[str, Any]:
    title = str(payload.get("title") or "").strip()
    description = str(payload.get("description") or "").strip()
    category = str(payload.get("category") or "").strip()
    delivery = str(payload.get("delivery_method") or payload.get("delivery_choice") or "").strip()
    combined = "\n".join((title, description, category, delivery))
    findings = _find(REVIEW_PATTERNS, combined, "review")
    findings.extend(_find(WARNING_PATTERNS, combined, "medium"))
    suggestions: List[str] = []
    if not category:
        suggestions.append(_u(r"\u8865\u5145\u4e0e\u5b9e\u9645\u5546\u54c1\u4e00\u81f4\u7684\u5177\u4f53\u7c7b\u76ee\uff0c\u4e0d\u8981\u4f7f\u7528\u7b3c\u7edf\u7c7b\u76ee\u3002"))
    if len(title) < 8:
        suggestions.append(_u(r"\u6807\u9898\u5e94\u8bf4\u660e\u5b9e\u9645\u4ea4\u4ed8\u5185\u5bb9\u6216\u670d\u52a1\u7ed3\u679c\uff0c\u907f\u514d\u53ea\u6709\u6cdb\u5316\u8bcd\u3002"))
    if len(description) < 30:
        suggestions.append(_u(r"\u63cf\u8ff0\u5e94\u5199\u6e05\u4ea4\u4ed8\u7269\u3001\u9002\u7528\u8303\u56f4\u3001\u4ea4\u4ed8\u65f6\u95f4\u548c\u552e\u540e\u8fb9\u754c\u3002"))
    return {
        "passed": True,
        "can_publish": True,
        "risk_level": "review" if findings else "low",
        "findings": findings,
        "suggestions": suggestions,
        "notice": _u(r"\u68c0\u67e5\u7ed3\u679c\u4ec5\u4f9b\u53d1\u5e03\u524d\u590d\u6838\uff0c\u4e0d\u80fd\u4ee3\u66ff\u5e73\u53f0\u6700\u7ec8\u5ba1\u6838\u3002"),
    }


def build_ai_optimization_prompt(payload: Dict[str, Any]) -> str:
    result = check_product(payload)
    return (
        _u(r"\u8bf7\u6839\u636e\u771f\u5b9e\u5546\u54c1\u5185\u5bb9\u751f\u6210\u9002\u5408\u95f2\u9c7c\u7684\u5546\u54c1\u6587\u6848\uff0c\u4e0d\u865a\u6784\u6388\u6743\u3001\u529f\u80fd\u3001\u6548\u679c\u6216\u552e\u540e\u627f\u8bfa\u3002"),
        _u(r"\n\u6587\u6848\u7ed3\u6784\uff1a\n1. \u6807\u9898\uff1a\u5199\u6e05\u5b9e\u9645\u4ea4\u4ed8\u7269\u6216\u670d\u52a1\u7ed3\u679c\u3002\n2. \u4e00\u53e5\u8bf4\u660e\uff1a\u7528\u4e00\u53e5\u8bf4\u6e05\u5546\u54c1\u89e3\u51b3\u7684\u95ee\u9898\u3002\n3. \u529f\u80fd\u6216\u4ea4\u4ed8\uff1a\u5217\u51fa\u5b9e\u9645\u5185\u5bb9\u3002\n4. \u9002\u7528\u4eba\u7fa4\u4e0e\u73af\u5883\uff1a\u5199\u6e05\u7cfb\u7edf\u3001\u7248\u672c\u548c\u524d\u7f6e\u6761\u4ef6\u3002\n5. \u4ea4\u4ed8\u548c\u552e\u540e\uff1a\u5199\u6e05\u4ea4\u4ed8\u65b9\u5f0f\u3001\u54a8\u8be2\u8303\u56f4\u548c\u9000\u6362\u8fb9\u754c\u3002\n6. \u7b2c\u4e09\u65b9\u5173\u7cfb\uff1a\u4ec5\u5728\u4e8b\u5b9e\u6210\u7acb\u65f6\u8bf4\u660e\u3002\n\n\u7981\u6b62\u5938\u5927\u3001\u7edd\u5bf9\u5316\u3001\u4fdd\u8bc1\u6027\u8868\u8ff0\uff0c\u7981\u6b62\u628a\u4e0d\u540c\u5546\u54c1\u7684\u4ea4\u4ed8\u5185\u5bb9\u6df7\u5728\u4e00\u8d77\u3002"),
        "\nTitle: ", payload.get("title", ""), "\nDescription: ", payload.get("description", ""),
        "\nFindings: ", str(result["findings"]), "\nSuggestions: ", str(result["suggestions"]),
    )
