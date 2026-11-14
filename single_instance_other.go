//go:build !linux

package main

func singleInstanceAvailable() bool { return true }
