#!/bin/bash
cd `dirname $0`

if [ -f input.csv ]
then
	./bundle/lighthouse-genius input.csv	
else
	echo "Please provide input.csv"
fi

read -p "Press enter to leave"
