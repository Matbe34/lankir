package cli

import (
	"fmt"
	"strconv"
	"strings"
)

// maxPages bounds page numbers and page lists, far above any real document,
// so a typo like "1-99999999" fails instead of exhausting memory.
const maxPages = 100000

// parsePages parses a 1-based page list such as "1,3-5" into [1 3 4 5]. Order is kept.
func parsePages(s string) ([]int, error) {
	if strings.TrimSpace(s) == "" {
		return nil, fmt.Errorf("empty page list")
	}
	var pages []int
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		lo, hi, isRange := strings.Cut(part, "-")
		from, err := parsePageNumber(lo, part)
		if err != nil {
			return nil, err
		}
		to := from
		if isRange {
			if to, err = parsePageNumber(hi, part); err != nil {
				return nil, err
			}
			if to < from {
				return nil, fmt.Errorf("invalid range %q: end before start", part)
			}
		}
		if len(pages)+to-from+1 > maxPages {
			return nil, fmt.Errorf("too many pages (more than %d)", maxPages)
		}
		for p := from; p <= to; p++ {
			pages = append(pages, p)
		}
	}
	return pages, nil
}

func parsePageNumber(s, part string) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 1 || n > maxPages {
		return 0, fmt.Errorf("invalid page %q in %q (pages run from 1 to %d)", s, part, maxPages)
	}
	return n, nil
}

// parseRanges parses ";"-separated page lists, each of which becomes one split output.
func parseRanges(s string) ([][]int, error) {
	var ranges [][]int
	total := 0
	for _, group := range strings.Split(s, ";") {
		pages, err := parsePages(group)
		if err != nil {
			return nil, err
		}
		if total += len(pages); total > maxPages {
			return nil, fmt.Errorf("too many pages across ranges (more than %d)", maxPages)
		}
		ranges = append(ranges, pages)
	}
	return ranges, nil
}

// chunks splits pages 1..total into consecutive groups of at most size pages.
func chunks(total, size int) [][]int {
	size = min(size, total)
	var out [][]int
	for start := 1; start <= total; start += size {
		var c []int
		for p := start; p < start+size && p <= total; p++ {
			c = append(c, p)
		}
		out = append(out, c)
	}
	return out
}
