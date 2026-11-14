package cli

import (
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestParsePages(t *testing.T) {
	tests := []struct {
		in      string
		want    []int
		wantErr bool
	}{
		{"1", []int{1}, false},
		{"1,3-5", []int{1, 3, 4, 5}, false},
		{"3,1,2", []int{3, 1, 2}, false},
		{" 2 , 4-5 ", []int{2, 4, 5}, false},
		{"2-2", []int{2}, false},
		{"", nil, true},
		{"0", nil, true},
		{"-1", nil, true},
		{"5-3", nil, true},
		{"0-3", nil, true},
		{"a", nil, true},
		{"1-a", nil, true},
		{"1,", nil, true},
		{",1", nil, true},
		{"1,,2", nil, true},
		{"1-2-3", nil, true},
		{"1-99999999", nil, true},
		{"1-9223372036854775807", nil, true},
		{"9223372036854775807-9223372036854775807", nil, true},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, err := parsePages(tt.in)
			if (err != nil) != tt.wantErr {
				t.Fatalf("parsePages(%q) error = %v, wantErr %v", tt.in, err, tt.wantErr)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("parsePages(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestParseRanges(t *testing.T) {
	got, err := parseRanges("1-3,4;7-9")
	if err != nil {
		t.Fatal(err)
	}
	want := [][]int{{1, 2, 3, 4}, {7, 8, 9}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
	for _, bad := range []string{"", "1-3;", ";1", "1;a"} {
		if _, err := parseRanges(bad); err == nil {
			t.Errorf("parseRanges(%q): expected error", bad)
		}
	}
}

func TestChunks(t *testing.T) {
	got := chunks(7, 3)
	want := [][]int{{1, 2, 3}, {4, 5, 6}, {7}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestChunksLargerThanDocument(t *testing.T) {
	got := chunks(5, math.MaxInt)
	if want := [][]int{{1, 2, 3, 4, 5}}; !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestParseRangesCapsTotal(t *testing.T) {
	if _, err := parseRanges(strings.Repeat("1-100000;", 2) + "1-100000"); err == nil {
		t.Fatal("ranges totalling more than maxPages pages must be refused")
	}
}
